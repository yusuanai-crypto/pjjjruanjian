import { Injectable, Optional } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import { OperationLogsNestService } from '../operation-logs/operation-log.nest.service';
import {
  assertRestrictedBalancesNonNegative,
  calculateStockMetrics,
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

const SERIALIZED_WRITE_ROLES = new Set([
  'super_admin',
  'admin',
  'warehouse',
]);
const SERIALIZED_COST_ROLES = new Set([
  'super_admin',
  'admin',
  'finance',
]);
const ZERO_DELTA = {
  onHandDelta: 0,
  reservedDelta: 0,
  unavailableDelta: 0,
  inTransitDelta: 0,
};

@Injectable()
export class SerializedInventoryAccountingAdapter {
  constructor(
    @Optional()
    private readonly repository?: InventoryPrismaRepository,
    @Optional()
    private readonly operationLogsService?: OperationLogsNestService,
    @Optional()
    private readonly postCommitService?: InventoryPostCommitService,
  ) {}

  rejectQuantityCommand() {
    throw createHttpError(
      409,
      'INVENTORY_SERIALIZED_ADAPTER_REQUIRED',
      'Serialized products must be changed through the per-unit inventory adapter.',
    );
  }

  validateTransferContract(
    unitIds: unknown,
    plannedQty: number,
    field = 'unitIds',
  ) {
    const normalized = normalizeUnitIds(unitIds, field);
    if (normalized.length === 0) {
      throw createHttpError(
        400,
        'INVENTORY_SERIALIZED_TRANSFER_UNITS_REQUIRED',
        `${field} must contain the serialized unit IDs selected for transfer.`,
      );
    }
    if (normalized.length !== plannedQty) {
      throw createHttpError(
        400,
        'INVENTORY_SERIALIZED_TRANSFER_QUANTITY_MISMATCH',
        `${field} count must equal plannedQty.`,
      );
    }
    return normalized;
  }

  async returnAfterSalesUnitInTransaction(
    transaction: any,
    actor: any,
    input: {
      receiptId: string;
      receiptLineId: string;
      serializedReceiptUnitId: string;
      sourceSalesOrderId: string;
      warehouseId: string;
      productId: string;
      unitId: string;
      normalizedScannedLogisticsCode: string;
      condition: 'SALEABLE' | 'UNAVAILABLE';
      sourceKey: string;
      reason?: string | null;
    },
    metadata: any = {},
  ) {
    const warehouse = await this.loadActiveWarehouse(
      transaction,
      input.warehouseId,
    );
    const product = await this.loadSerializedProduct(
      transaction,
      input.productId,
    );
    const unit =
      await transaction.serializedInventoryUnit.findUnique({
        where: { id: input.unitId },
        include: {
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
        },
      });
    const belongsToSourceOrder = (unit?.assignments || []).some(
      (assignment: any) =>
        assignment.reservation?.salesOrderId === input.sourceSalesOrderId &&
        assignment.reservation?.productId === input.productId,
    );
    if (
      !unit ||
      unit.productId !== input.productId ||
      unit.status !== 'OUTBOUND' ||
      !unit.warehouseId ||
      unit.normalizedLogisticsCode !==
        input.normalizedScannedLogisticsCode ||
      !belongsToSourceOrder
    ) {
      throw createHttpError(
        409,
        'AFTER_SALES_SERIALIZED_UNIT_CONFLICT',
        'The scanned bottle is not an outbound bottle from the source sales order.',
      );
    }
    const envelope = serializedEnvelope(
      'SERIALIZED_AFTER_SALES_RETURN',
      {
        sourceKey: input.sourceKey,
        idempotencyKey: `idem:${input.sourceKey}`,
      },
      {
        receiptId: input.receiptId,
        receiptLineId: input.receiptLineId,
        serializedReceiptUnitId: input.serializedReceiptUnitId,
        sourceSalesOrderId: input.sourceSalesOrderId,
        warehouseId: warehouse.id,
        productId: product.id,
        unitId: unit.id,
        condition: input.condition,
        normalizedScannedLogisticsCode:
          input.normalizedScannedLogisticsCode,
      },
    );
    const result = await this.executeSerializedCommandInTransaction(
      transaction,
      'SERIALIZED_AFTER_SALES_RETURN',
      actor,
      envelope,
      metadata,
      async (commandReceipt) => {
        const now = new Date();
        const nextStatus =
          input.condition === 'UNAVAILABLE'
            ? 'UNAVAILABLE'
            : 'AVAILABLE';
        const document = await this.createDocument(
          transaction,
          commandReceipt,
          envelope,
          actor,
          {
            type: 'CUSTOMER_RETURN',
            warehouseId: warehouse.id,
            sourceType: 'serialized_after_sales_return',
            sourceId: input.receiptId,
            businessAt: now,
            reason:
              input.reason ??
              'Serialized bottle received for an after-sales return.',
          },
        );
        const line =
          await this.requiredRepository().createDocumentLine(
            transaction,
            {
              documentId: document.id,
              lineNo: 1,
              productId: product.id,
              batchId: null,
              quantity: 1,
              condition:
                input.condition === 'UNAVAILABLE'
                  ? 'UNAVAILABLE'
                  : 'SALEABLE',
              productNameSnapshot: product.name,
              unitSnapshot: product.unit,
              purchaseUnitCostCents: unit.purchaseCostCents,
              notes: `After-sales receipt line ${input.receiptLineId}.`,
            },
          );
        const changed =
          await transaction.serializedInventoryUnit.updateMany({
            where: {
              id: unit.id,
              version: unit.version,
              productId: product.id,
              warehouseId: unit.warehouseId,
              status: 'OUTBOUND',
            },
            data: {
              warehouseId: warehouse.id,
              status: nextStatus,
              version: { increment: 1 },
              updatedById: actorId(actor),
              updatedAt: now,
            },
          });
        if (Number(changed?.count || 0) !== 1) {
          throw concurrentUpdateError();
        }
        const movement =
          await this.requiredRepository().createMovement(transaction, {
            sourceKey: childSourceKey(
              envelope.sourceKey,
              `movement-${unit.id}`,
            ),
            documentLineId: line.id,
            warehouseId: warehouse.id,
            productId: product.id,
            batchId: null,
            serializedUnitId: unit.id,
            reservationId: null,
            movementType: 'CUSTOMER_RETURN',
            onHandDelta: 1,
            reservedDelta: 0,
            unavailableDelta:
              input.condition === 'UNAVAILABLE' ? 1 : 0,
            inTransitDelta: 0,
            businessAt: now,
            operatorUserId: actorId(actor),
            operatorNameSnapshot: actorName(actor),
            operatorRoleSnapshot: actorRole(actor),
            productNameSnapshot: product.name,
            unitSnapshot: product.unit,
            purchaseUnitCostCents: unit.purchaseCostCents,
            reason:
              input.reason ??
              'Serialized bottle received for an after-sales return.',
          });
        const stockChange = await this.applyStockDelta(
          transaction,
          warehouse.id,
          product.id,
          {
            ...ZERO_DELTA,
            onHandDelta: 1,
            unavailableDelta:
              input.condition === 'UNAVAILABLE' ? 1 : 0,
          },
          movement.id,
        );
        return {
          document,
          movementIds: [movement.id],
          stockChanges: [stockChange],
          unitIds: [unit.id],
          auditBefore: {
            unitId: unit.id,
            status: 'outbound',
            warehouseId: unit.warehouseId,
          },
          auditAfter: {
            unitId: unit.id,
            status: String(nextStatus).toLowerCase(),
            warehouseId: warehouse.id,
          },
        };
      },
    );
    return {
      ...result,
      previousWarehouseId: unit.warehouseId,
      previousStatus: unit.status,
      inventoryMovementId: result.movementIds?.[0] ?? null,
    };
  }

  async restoreAfterSalesReturnedUnitInTransaction(
    transaction: any,
    actor: any,
    input: {
      unitId: string;
      receiptWarehouseId: string;
      previousWarehouseId: string;
      currentCondition: 'SALEABLE' | 'UNAVAILABLE';
    },
  ) {
    const unit =
      await transaction.serializedInventoryUnit.findUnique({
        where: { id: input.unitId },
      });
    const expectedStatus =
      input.currentCondition === 'UNAVAILABLE'
        ? 'UNAVAILABLE'
        : 'AVAILABLE';
    if (
      !unit ||
      unit.warehouseId !== input.receiptWarehouseId ||
      unit.status !== expectedStatus
    ) {
      throw createHttpError(
        409,
        'AFTER_SALES_SERIALIZED_REVERSAL_CONFLICT',
        'The returned bottle changed after receipt and cannot be reversed safely.',
      );
    }
    const changed =
      await transaction.serializedInventoryUnit.updateMany({
        where: {
          id: unit.id,
          version: unit.version,
          warehouseId: input.receiptWarehouseId,
          status: expectedStatus,
        },
        data: {
          warehouseId: input.previousWarehouseId,
          status: 'OUTBOUND',
          version: { increment: 1 },
          updatedById: actorId(actor),
          updatedAt: new Date(),
        },
      });
    if (Number(changed?.count || 0) !== 1) {
      throw concurrentUpdateError();
    }
  }

  async transitionTransferOutboundInTransaction(
    transaction: any,
    actor: any,
    input: {
      unitIds: string[];
      productId: string;
      fromWarehouseId: string;
    },
  ) {
    const units =
      await transaction.serializedInventoryUnit.findMany({
        where: { id: { in: input.unitIds } },
      });
    const byId = new Map<string, any>(
      units.map((unit: any) => [unit.id, unit]),
    );
    const ordered = input.unitIds.map((id) => byId.get(id));
    if (
      ordered.some(
        (unit) =>
          !unit ||
          unit.productId !== input.productId ||
          unit.warehouseId !== input.fromWarehouseId ||
          unit.status !== 'AVAILABLE' ||
          unit.purchaseCostCents === null,
      )
    ) {
      throw createHttpError(
        409,
        'INVENTORY_SERIALIZED_TRANSFER_UNIT_UNAVAILABLE',
        'Every selected bottle must be saleable in the source warehouse.',
      );
    }
    for (const unit of ordered) {
      const changed =
        await transaction.serializedInventoryUnit.updateMany({
          where: {
            id: unit.id,
            version: unit.version,
            warehouseId: input.fromWarehouseId,
            productId: input.productId,
            status: 'AVAILABLE',
          },
          data: {
            status: 'OUTBOUND',
            version: { increment: 1 },
            updatedById: actorId(actor),
            updatedAt: new Date(),
          },
        });
      if (Number(changed?.count || 0) !== 1) {
        throw concurrentUpdateError();
      }
    }
    return ordered;
  }

  async transitionTransferReceiptInTransaction(
    transaction: any,
    actor: any,
    input: {
      receivedUnitIds: string[];
      unavailableUnitIds: string[];
      differenceUnitIds: string[];
      productId: string;
      fromWarehouseId: string;
      toWarehouseId: string;
      transferUnitIds: string[];
    },
  ) {
    const allIds = [
      ...input.receivedUnitIds,
      ...input.differenceUnitIds,
    ];
    if (new Set(allIds).size !== allIds.length) {
      throw validationError(
        'A serialized transfer receipt cannot repeat a bottle.',
      );
    }
    const transferIds = new Set(input.transferUnitIds);
    if (allIds.some((id) => !transferIds.has(id))) {
      throw createHttpError(
        409,
        'INVENTORY_SERIALIZED_TRANSFER_UNIT_MISMATCH',
        'A received or difference bottle is not part of the transfer line.',
      );
    }
    const unavailableIds = new Set(input.unavailableUnitIds);
    if (
      input.unavailableUnitIds.some(
        (id) => !input.receivedUnitIds.includes(id),
      )
    ) {
      throw validationError(
        'unavailableUnitIds must be a subset of receivedUnitIds.',
      );
    }
    const units =
      await transaction.serializedInventoryUnit.findMany({
        where: { id: { in: allIds } },
      });
    const byId = new Map<string, any>(
      units.map((unit: any) => [unit.id, unit]),
    );
    const ordered = allIds.map((id) => byId.get(id));
    if (
      ordered.some(
        (unit) =>
          !unit ||
          unit.productId !== input.productId ||
          unit.warehouseId !== input.fromWarehouseId ||
          unit.status !== 'OUTBOUND',
      )
    ) {
      throw createHttpError(
        409,
        'INVENTORY_SERIALIZED_TRANSFER_UNIT_NOT_IN_TRANSIT',
        'Every receipt bottle must still be in transit from the source warehouse.',
      );
    }
    for (const unitId of input.receivedUnitIds) {
      const unit = byId.get(unitId);
      const nextStatus = unavailableIds.has(unitId)
        ? 'UNAVAILABLE'
        : 'AVAILABLE';
      const changed =
        await transaction.serializedInventoryUnit.updateMany({
          where: {
            id: unit.id,
            version: unit.version,
            warehouseId: input.fromWarehouseId,
            productId: input.productId,
            status: 'OUTBOUND',
          },
          data: {
            warehouseId: input.toWarehouseId,
            status: nextStatus,
            version: { increment: 1 },
            updatedById: actorId(actor),
            updatedAt: new Date(),
          },
        });
      if (Number(changed?.count || 0) !== 1) {
        throw concurrentUpdateError();
      }
    }
    for (const unitId of input.differenceUnitIds) {
      const unit = byId.get(unitId);
      const changed =
        await transaction.serializedInventoryUnit.updateMany({
          where: {
            id: unit.id,
            version: unit.version,
            warehouseId: input.fromWarehouseId,
            productId: input.productId,
            status: 'OUTBOUND',
          },
          data: {
            status: 'VOID',
            correctionReason:
              'Serialized transfer difference; review the receipt audit trail.',
            correctedById: actorId(actor),
            correctedAt: new Date(),
            version: { increment: 1 },
            updatedById: actorId(actor),
            updatedAt: new Date(),
          },
        });
      if (Number(changed?.count || 0) !== 1) {
        throw concurrentUpdateError();
      }
    }
    return {
      receivedUnits: input.receivedUnitIds.map((id) => byId.get(id)),
      differenceUnits: input.differenceUnitIds.map((id) => byId.get(id)),
    };
  }

  async reverseTransferReceiptUnitsInTransaction(
    transaction: any,
    actor: any,
    input: {
      receivedUnitIds: string[];
      unavailableUnitIds: string[];
      differenceUnitIds: string[];
      fromWarehouseId: string;
      toWarehouseId: string;
    },
  ) {
    const unavailable = new Set(input.unavailableUnitIds);
    for (const unitId of input.receivedUnitIds) {
      const unit =
        await transaction.serializedInventoryUnit.findUnique({
          where: { id: unitId },
        });
      const expectedStatus = unavailable.has(unitId)
        ? 'UNAVAILABLE'
        : 'AVAILABLE';
      const changed =
        await transaction.serializedInventoryUnit.updateMany({
          where: {
            id: unitId,
            version: unit?.version,
            warehouseId: input.toWarehouseId,
            status: expectedStatus,
          },
          data: {
            warehouseId: input.fromWarehouseId,
            status: 'OUTBOUND',
            version: { increment: 1 },
            updatedById: actorId(actor),
            updatedAt: new Date(),
          },
        });
      if (Number(changed?.count || 0) !== 1) {
        throw concurrentUpdateError();
      }
    }
    for (const unitId of input.differenceUnitIds) {
      const unit =
        await transaction.serializedInventoryUnit.findUnique({
          where: { id: unitId },
        });
      const changed =
        await transaction.serializedInventoryUnit.updateMany({
          where: {
            id: unitId,
            version: unit?.version,
            warehouseId: input.fromWarehouseId,
            status: 'VOID',
          },
          data: {
            status: 'OUTBOUND',
            correctionReason: null,
            correctedById: actorId(actor),
            correctedAt: new Date(),
            version: { increment: 1 },
            updatedById: actorId(actor),
            updatedAt: new Date(),
          },
        });
      if (Number(changed?.count || 0) !== 1) {
        throw concurrentUpdateError();
      }
    }
  }

  async reverseTransferOutboundUnitsInTransaction(
    transaction: any,
    actor: any,
    input: {
      unitIds: string[];
      fromWarehouseId: string;
      productId: string;
    },
  ) {
    for (const unitId of input.unitIds) {
      const unit =
        await transaction.serializedInventoryUnit.findUnique({
          where: { id: unitId },
        });
      const changed =
        await transaction.serializedInventoryUnit.updateMany({
          where: {
            id: unitId,
            version: unit?.version,
            warehouseId: input.fromWarehouseId,
            productId: input.productId,
            status: 'OUTBOUND',
          },
          data: {
            status: 'AVAILABLE',
            version: { increment: 1 },
            updatedById: actorId(actor),
            updatedAt: new Date(),
          },
        });
      if (Number(changed?.count || 0) !== 1) {
        throw concurrentUpdateError();
      }
    }
  }

  async createUnits(actor: any, input: any, metadata: any = {}) {
    requireRole(actor, SERIALIZED_WRITE_ROLES);
    const rows = Array.isArray(input?.units) ? input.units : [];
    const envelope = serializedEnvelope(
      'SERIALIZED_INBOUND',
      input,
      {
        warehouseId: input?.warehouseId,
        productId: input?.productId,
        condition: input?.condition,
        units: rows.map(serializedUnitHashSnapshot),
      },
    );
    const result = await this.runStandaloneSerializedCommand(
      envelope,
      async (transaction) =>
        await this.createUnitsInTransaction(
          transaction,
          actor,
          input,
          metadata,
        ),
    );
    await this.dispatchReceipt(result.commandReceiptId);
    return result;
  }

  /**
   * Automatic domain workflows use this entry point so the serialized receipt,
   * business fact and their own state transition commit atomically. Public
   * inventory entry continues to use createUnits(), which enforces inventory
   * operator roles before opening its transaction.
   */
  async createUnitsInTransaction(
    transaction: any,
    actor: any,
    input: any,
    metadata: any = {},
  ) {
    const repository = this.requiredRepository();
    const rows = Array.isArray(input?.units) ? input.units : [];
    if (rows.length === 0) {
      throw validationError('units must contain at least one serialized unit.');
    }
    const envelope = serializedEnvelope(
      'SERIALIZED_INBOUND',
      input,
      {
        warehouseId: input.warehouseId,
        productId: input.productId,
        condition: input.condition,
        units: rows.map(serializedUnitHashSnapshot),
      },
    );
    return this.executeSerializedCommandInTransaction(
      transaction,
      'SERIALIZED_INBOUND',
      actor,
      envelope,
      metadata,
      async (receipt) => {
        const warehouse = await this.loadActiveWarehouse(
          transaction,
          requiredString(input.warehouseId, 'warehouseId'),
        );
        const product = await this.loadSerializedProduct(
          transaction,
          requiredString(input.productId, 'productId'),
        );
        const now = new Date();
        const sourceType =
          optionalString(input.sourceType) || 'SERIALIZED_INBOUND';
        const reason =
          optionalString(input.reason) || 'Serialized inventory batch entry.';
        const document = await this.createDocument(
          transaction,
          receipt,
          envelope,
          actor,
          {
            type: 'OTHER_IN',
            warehouseId: warehouse.id,
            sourceType,
            sourceId: optionalString(input.sourceId) || product.id,
            businessAt: now,
            reason,
          },
        );
        const forcedUnavailable =
          String(input?.condition || '').trim().toUpperCase() ===
          'UNAVAILABLE';
        const line = await repository.createDocumentLine(transaction, {
          documentId: document.id,
          lineNo: 1,
          productId: product.id,
          batchId: null,
          quantity: rows.length,
          condition: !forcedUnavailable && rows.every(
            (row: any) =>
              row.purchaseCostCents !== null &&
              row.purchaseCostCents !== undefined,
          )
            ? 'SALEABLE'
            : 'UNAVAILABLE',
          productNameSnapshot: product.name,
          unitSnapshot: product.unit,
          purchaseUnitCostCents: null,
          notes: reason,
        });
        const created = [];
        const movements = [];
        let unavailableDelta = 0;
        for (const [index, row] of rows.entries()) {
          const pendingCost =
            row.purchaseCostCents === null ||
            row.purchaseCostCents === undefined;
          const unavailable = pendingCost || forcedUnavailable;
          const unit = await transaction.serializedInventoryUnit.create({
            data: {
              id: crypto.randomUUID(),
              productId: product.id,
              warehouseId: warehouse.id,
              inventoryBatchId: row.inventoryBatchId ?? null,
              moutaiName: row.moutaiName ?? product.name,
              normalizedMoutaiName:
                row.normalizedMoutaiName ??
                String(row.moutaiName ?? product.name)
                  .normalize('NFKC')
                  .trim()
                  .toLocaleLowerCase('zh-CN'),
              factoryDate: row.factoryDate ?? null,
              productionBatch: row.productionBatch ?? null,
              batchSerialNo: row.batchSerialNo ?? null,
              logisticsCode: requiredString(
                row.logisticsCode,
                `units[${index}].logisticsCode`,
              ),
              normalizedLogisticsCode: requiredString(
                row.normalizedLogisticsCode,
                `units[${index}].normalizedLogisticsCode`,
              ),
              purchaseCostCents: row.purchaseCostCents ?? null,
              status: pendingCost
                ? 'PENDING_COST'
                : forcedUnavailable
                  ? 'UNAVAILABLE'
                  : 'AVAILABLE',
              version: 0,
              createdById: actorId(actor),
              updatedById: actorId(actor),
              createdAt: now,
              updatedAt: now,
            },
          });
          unavailableDelta += unavailable ? 1 : 0;
          const movement = await repository.createMovement(transaction, {
            sourceKey: childSourceKey(
              envelope.sourceKey,
              `unit-${index + 1}-${unit.id}`,
            ),
            documentLineId: line.id,
            warehouseId: warehouse.id,
            productId: product.id,
            batchId: unit.inventoryBatchId,
            serializedUnitId: unit.id,
            reservationId: null,
            movementType: 'PURCHASE_IN',
            onHandDelta: 1,
            reservedDelta: 0,
            unavailableDelta: unavailable ? 1 : 0,
            inTransitDelta: 0,
            businessAt: now,
            operatorUserId: actorId(actor),
            operatorNameSnapshot: actorName(actor),
            operatorRoleSnapshot: actorRole(actor),
            productNameSnapshot: product.name,
            unitSnapshot: product.unit,
            purchaseUnitCostCents: row.purchaseCostCents ?? null,
            reason,
          });
          created.push(unit);
          movements.push(movement);
        }
        const stockChange = await this.applyStockDelta(
          transaction,
          warehouse.id,
          product.id,
          {
            ...ZERO_DELTA,
            onHandDelta: rows.length,
            unavailableDelta,
          },
          movements[movements.length - 1].id,
        );
        return {
          document,
          movementIds: movements.map((movement) => movement.id),
          stockChanges: [stockChange],
          unitIds: created.map((unit) => unit.id),
          auditBefore: null,
          auditAfter: {
            warehouseId: warehouse.id,
            productId: product.id,
            createdCount: created.length,
            pendingCostCount: unavailableDelta,
          },
        };
      },
    );
  }

  async completeUnitCost(
    actor: any,
    unitId: string,
    purchaseCostCents: number,
    reason: string,
    metadata: any = {},
  ) {
    requireRole(actor, SERIALIZED_COST_ROLES);
    if (
      !Number.isSafeInteger(purchaseCostCents) ||
      purchaseCostCents < 0
    ) {
      throw validationError(
        'purchaseCostCents must be a non-negative integer.',
      );
    }
    const repository = this.requiredRepository();
    const sourceSeed = `serialized-cost:${shortHash(unitId)}:${purchaseCostCents}`;
    const envelope = serializedEnvelope(
      'SERIALIZED_COST_COMPLETE',
      {
        sourceKey: metadata.sourceKey ?? sourceSeed,
        idempotencyKey: metadata.idempotencyKey ?? `idem:${sourceSeed}`,
        requestHash: metadata.requestHash,
      },
      { unitId, purchaseCostCents, reason },
    );
    const result = await this.runStandaloneSerializedCommand(
      envelope,
      async (transaction) =>
        await this.executeSerializedCommandInTransaction(
          transaction,
          'SERIALIZED_COST_COMPLETE',
          actor,
          envelope,
          metadata,
          async (receipt) => {
            const unit =
              await transaction.serializedInventoryUnit.findUnique({
                where: { id: unitId },
              });
            if (!unit) {
              throw createHttpError(
                404,
                'SERIALIZED_INVENTORY_NOT_FOUND',
                'The serialized inventory unit does not exist.',
              );
            }
            if (!unit.warehouseId) {
              throw createHttpError(
                409,
                'SERIALIZED_INVENTORY_WAREHOUSE_REQUIRED',
                'A historical unit must be assigned by the cutover workflow before its cost can release inventory.',
              );
            }
            const product = await this.loadSerializedProduct(
              transaction,
              unit.productId,
              false,
            );
            await this.loadActiveWarehouse(
              transaction,
              unit.warehouseId,
            );
            if (unit.status === 'OUTBOUND' || unit.status === 'VOID') {
              throw createHttpError(
                409,
                'SERIALIZED_INVENTORY_COST_STATE_IMMUTABLE',
                'Outbound or void serialized inventory cannot be maintained through the ordinary cost endpoint.',
              );
            }
            const releasing = unit.status === 'PENDING_COST';
            const changed =
              await transaction.serializedInventoryUnit.updateMany({
                where: {
                  id: unit.id,
                  version: unit.version,
                  status: unit.status,
                },
                data: {
                  purchaseCostCents,
                  status: releasing ? 'AVAILABLE' : unit.status,
                  version: { increment: 1 },
                  updatedById: actorId(actor),
                  updatedAt: new Date(),
                },
              });
            if (Number(changed?.count || 0) !== 1) {
              throw concurrentUpdateError();
            }
            const document = await this.createDocument(
              transaction,
              receipt,
              envelope,
              actor,
              {
                type: 'UNAVAILABLE_ADJUSTMENT',
                warehouseId: unit.warehouseId,
                sourceType: 'SERIALIZED_COST',
                sourceId: unit.id,
                businessAt: new Date(),
                reason,
              },
            );
            const line = await repository.createDocumentLine(transaction, {
              documentId: document.id,
              lineNo: 1,
              productId: product.id,
              batchId: unit.inventoryBatchId,
              quantity: 1,
              condition: 'SALEABLE',
              productNameSnapshot: product.name,
              unitSnapshot: product.unit,
              purchaseUnitCostCents: purchaseCostCents,
              notes: reason,
            });
            const movements = [];
            const stockChanges = [];
            if (releasing) {
              const movement = await repository.createMovement(
                transaction,
                {
                  sourceKey: childSourceKey(
                    envelope.sourceKey,
                    'release-unavailable',
                  ),
                  documentLineId: line.id,
                  warehouseId: unit.warehouseId,
                  productId: product.id,
                  batchId: unit.inventoryBatchId,
                  serializedUnitId: unit.id,
                  reservationId: null,
                  movementType: 'UNAVAILABLE_OUT',
                  onHandDelta: 0,
                  reservedDelta: 0,
                  unavailableDelta: -1,
                  inTransitDelta: 0,
                  businessAt: new Date(),
                  operatorUserId: actorId(actor),
                  operatorNameSnapshot: actorName(actor),
                  operatorRoleSnapshot: actorRole(actor),
                  productNameSnapshot: product.name,
                  unitSnapshot: product.unit,
                  purchaseUnitCostCents: purchaseCostCents,
                  reason,
                },
              );
              movements.push(movement);
              stockChanges.push(
                await this.applyStockDelta(
                  transaction,
                  unit.warehouseId,
                  product.id,
                  {
                    ...ZERO_DELTA,
                    unavailableDelta: -1,
                  },
                  movement.id,
                ),
              );
            }
            return {
              document,
              movementIds: movements.map((movement) => movement.id),
              stockChanges,
              unitIds: [unit.id],
              auditBefore: {
                unitId: unit.id,
                status: String(unit.status).toLowerCase(),
                purchaseCostCents: unit.purchaseCostCents,
              },
              auditAfter: {
                unitId: unit.id,
                status: String(
                  releasing ? 'AVAILABLE' : unit.status,
                ).toLowerCase(),
                purchaseCostCents,
              },
            };
          },
        ),
    );
    await this.dispatchReceipt(result.commandReceiptId);
    return result;
  }

  async assignReservationUnitsInTransaction(
    transaction: any,
    actor: any,
    input: {
      reservationId: string;
      unitIds?: string[];
      autoAssignCount?: number;
      outbound: boolean;
      sourceKey: string;
      idempotencyKey?: string;
      requestHash?: string;
      reason?: string;
    },
    metadata: any = {},
  ) {
    const reservation =
      await transaction.inventoryReservation.findUnique({
        where: { id: input.reservationId },
      });
    if (!reservation) {
      throw createHttpError(
        404,
        'INVENTORY_RESERVATION_NOT_FOUND',
        'The serialized inventory reservation does not exist.',
      );
    }
    const activeAssignments =
      await transaction.serializedInventoryAssignment.findMany({
        where: {
          reservationId: reservation.id,
          status: 'RESERVED',
        },
        include: { serializedUnit: true },
        orderBy: [{ reservedAt: 'asc' }, { id: 'asc' }],
      });
    const requestedIds =
      input.unitIds === undefined
        ? []
        : normalizeUnitIds(input.unitIds, 'unitIds');
    const retainedAssignments =
      requestedIds.length === 0
        ? []
        : await transaction.serializedInventoryAssignment.findMany({
            where: {
              reservationId: reservation.id,
              serializedUnitId: { in: requestedIds },
              status: { in: ['RESERVED', 'OUTBOUND'] },
            },
          });
    const retainedIds = new Set(
      retainedAssignments.map(
        (assignment: any) => assignment.serializedUnitId,
      ),
    );
    const existingIds = new Set(
      activeAssignments.map(
        (assignment: any) => assignment.serializedUnitId,
      ),
    );
    const newRequestedIds = requestedIds.filter(
      (id) => !retainedIds.has(id),
    );
    const activeQty = activeAssignments.length;
    const capacity = Math.max(
      0,
      Number(reservation.requestedQty || 0) -
        Number(reservation.outboundQty || 0) -
        activeQty,
    );
    if (newRequestedIds.length > capacity) {
      throw createHttpError(
        409,
        'SERIALIZED_ASSIGNMENT_EXCEEDS_REQUESTED',
        'Selected serialized units exceed the unassigned order demand.',
      );
    }
    const autoAssignCount = Math.min(
      Math.max(0, Number(input.autoAssignCount || 0)),
      capacity - newRequestedIds.length,
    );
    let selectedNewUnits = [];
    if (newRequestedIds.length > 0) {
      const found =
        await transaction.serializedInventoryUnit.findMany({
          where: { id: { in: newRequestedIds } },
        });
      const byId = new Map(found.map((unit: any) => [unit.id, unit]));
      selectedNewUnits = newRequestedIds.map((id) => byId.get(id));
      if (selectedNewUnits.some((unit) => !unit)) {
        throw inventoryUnitUnavailableError();
      }
    }
    if (autoAssignCount > 0) {
      const excluded = [
        ...Array.from(existingIds),
        ...newRequestedIds,
      ];
      const fifoUnits =
        await transaction.serializedInventoryUnit.findMany({
          where: {
            productId: reservation.productId,
            warehouseId: reservation.warehouseId,
            status: 'AVAILABLE',
            purchaseCostCents: { not: null },
            moutaiName: { not: null },
            factoryDate: { not: null },
            productionBatch: { not: null },
            batchSerialNo: { not: null },
            logisticsCode: { not: null },
            ...(excluded.length > 0
              ? { id: { notIn: excluded } }
              : {}),
          },
          orderBy: [
            { factoryDate: 'asc' },
            { productionBatch: 'asc' },
            { batchSerialNo: 'asc' },
            { normalizedLogisticsCode: 'asc' },
            { id: 'asc' },
          ],
          take: autoAssignCount,
        });
      selectedNewUnits.push(...fifoUnits);
    }
    const outboundExisting = input.outbound
      ? activeAssignments
      : [];
    if (
      selectedNewUnits.length === 0 &&
      (!input.outbound || outboundExisting.length === 0)
    ) {
      return {
        changed: false,
        commandReceiptIds: [],
        assignedQty: activeQty,
        outboundQty: Number(reservation.outboundQty || 0),
      };
    }
    const envelope = serializedEnvelope(
      input.outbound
        ? 'SERIALIZED_ORDER_OUTBOUND'
        : 'SERIALIZED_ORDER_ASSIGN',
      {
        sourceKey: input.sourceKey,
        idempotencyKey:
          input.idempotencyKey ?? `idem:${input.sourceKey}`,
        requestHash: input.requestHash,
      },
      {
        reservationId: reservation.id,
        unitIds: [
          ...outboundExisting.map(
            (assignment: any) => assignment.serializedUnitId,
          ),
          ...selectedNewUnits.map((unit: any) => unit.id),
        ].sort(),
        outbound: input.outbound,
      },
    );
    const commandType = input.outbound
      ? 'SERIALIZED_ORDER_OUTBOUND'
      : 'SERIALIZED_ORDER_ASSIGN';
    const result = await this.executeSerializedCommandInTransaction(
      transaction,
      commandType,
      actor,
      envelope,
      metadata,
      async (receipt) =>
        await this.applyAssignmentCommand(
          transaction,
          actor,
          reservation,
          activeAssignments,
          selectedNewUnits,
          input.outbound,
          receipt,
          envelope,
          input.reason ??
            'Serialized sales order fulfillment.',
        ),
    );
    return {
      changed: !result.replayed,
      commandReceiptIds: [result.commandReceiptId],
      assignedQty: result.assignedQty,
      outboundQty: result.outboundQty,
    };
  }

  async releaseReservationAssignmentsInTransaction(
    transaction: any,
    actor: any,
    input: {
      reservationId: string;
      keepQty?: number;
      sourceKey: string;
      reason: string;
    },
    metadata: any = {},
  ) {
    const reservation =
      await transaction.inventoryReservation.findUnique({
        where: { id: input.reservationId },
      });
    if (!reservation) {
      return { changed: false, commandReceiptIds: [] };
    }
    const assignments =
      await transaction.serializedInventoryAssignment.findMany({
        where: {
          reservationId: reservation.id,
          status: 'RESERVED',
        },
        include: { serializedUnit: true },
        orderBy: [{ reservedAt: 'desc' }, { id: 'desc' }],
      });
    const keepQty = Math.max(0, Number(input.keepQty || 0));
    const release = assignments.slice(
      0,
      Math.max(0, assignments.length - keepQty),
    );
    if (release.length === 0) {
      return { changed: false, commandReceiptIds: [] };
    }
    const envelope = serializedEnvelope(
      'SERIALIZED_ORDER_RELEASE',
      {
        sourceKey: input.sourceKey,
        idempotencyKey: `idem:${input.sourceKey}`,
      },
      {
        reservationId: reservation.id,
        unitIds: release
          .map((assignment: any) => assignment.serializedUnitId)
          .sort(),
        reason: input.reason,
      },
    );
    const result = await this.executeSerializedCommandInTransaction(
      transaction,
      'SERIALIZED_ORDER_RELEASE',
      actor,
      envelope,
      metadata,
      async (receipt) =>
        await this.applyReleaseAssignmentCommand(
          transaction,
          actor,
          reservation,
          release,
          receipt,
          envelope,
          input.reason,
        ),
    );
    return {
      changed: !result.replayed,
      commandReceiptIds: [result.commandReceiptId],
    };
  }

  async postStocktakeInTransaction(
    transaction: any,
    actor: any,
    input: {
      stocktakeId: string;
      warehouseId: string;
      productId: string;
      sourceKey: string;
      idempotencyKey: string;
      reason: string;
    },
    metadata: any = {},
  ) {
    const repository = this.requiredRepository();
    const [warehouse, product, scans] = await Promise.all([
      this.loadActiveWarehouse(transaction, input.warehouseId),
      this.loadSerializedProduct(transaction, input.productId, false),
      transaction.stocktakeSerializedScan.findMany({
        where: { stocktakeId: input.stocktakeId },
        include: { serializedUnit: true },
        orderBy: [{ lineNo: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const plans: any[] = [];
    for (const scan of scans) {
      if (['UNKNOWN', 'CONFLICT'].includes(scan.matchStatus)) {
        throw createHttpError(
          409,
          'INVENTORY_STOCKTAKE_SERIALIZED_UNRESOLVED',
          'Unknown or conflicting bottle scans must be resolved before approval.',
        );
      }
      const unit = scan.serializedUnit;
      if (
        !unit ||
        unit.productId !== input.productId ||
        unit.warehouseId !== scan.expectedWarehouseId ||
        unit.status !== scan.expectedUnitStatus ||
        Number(unit.version) !== Number(scan.expectedUnitVersion)
      ) {
        throw createHttpError(
          409,
          'INVENTORY_STOCKTAKE_SNAPSHOT_STALE',
          'Serialized inventory changed after the count was submitted. Start a new stocktake.',
        );
      }
      if (unit.status === 'ALLOCATED') {
        throw createHttpError(
          409,
          'INVENTORY_STOCKTAKE_ALLOCATED_REVIEW_REQUIRED',
          'Historical ALLOCATED bottles require cutover review and cannot be adjusted by stocktake.',
        );
      }
      if (scan.matchStatus === 'MISSING') {
        if (unit.status === 'RESERVED') {
          throw createHttpError(
            409,
            'INVENTORY_STOCKTAKE_RESERVED_UNIT_MISSING',
            'A reserved bottle is missing and must be resolved through fulfillment before stocktake approval.',
          );
        }
        if (!['AVAILABLE', 'PENDING_COST', 'UNAVAILABLE'].includes(unit.status)) {
          throw createHttpError(
            409,
            'INVENTORY_STOCKTAKE_SERIALIZED_STATE_CONFLICT',
            'The missing bottle is not in a stocktake-adjustable state.',
          );
        }
        plans.push({
          scan,
          unit,
          nextStatus: 'VOID',
          onHandDelta: -1,
          unavailableDelta:
            ['PENDING_COST', 'UNAVAILABLE'].includes(unit.status) ? -1 : 0,
          movementType: 'STOCK_LOSS',
        });
        continue;
      }
      if (unit.status === 'RESERVED') {
        if (scan.countedCondition !== 'SALEABLE') {
          throw createHttpError(
            409,
            'INVENTORY_STOCKTAKE_RESERVED_UNIT_CONDITION_CONFLICT',
            'A reserved bottle cannot be made unavailable through stocktake.',
          );
        }
        continue;
      }
      if (
        unit.status === 'PENDING_COST' &&
        scan.countedCondition === 'SALEABLE'
      ) {
        throw createHttpError(
          409,
          'INVENTORY_PENDING_COST_RESTORE_FORBIDDEN',
          'A pending-cost bottle cannot become saleable through stocktake.',
        );
      }
      if (
        unit.status === 'AVAILABLE' &&
        scan.countedCondition === 'UNAVAILABLE'
      ) {
        plans.push({
          scan,
          unit,
          nextStatus: 'UNAVAILABLE',
          onHandDelta: 0,
          unavailableDelta: 1,
          movementType: 'UNAVAILABLE_IN',
        });
      } else if (
        unit.status === 'UNAVAILABLE' &&
        scan.countedCondition === 'SALEABLE'
      ) {
        plans.push({
          scan,
          unit,
          nextStatus: 'AVAILABLE',
          onHandDelta: 0,
          unavailableDelta: -1,
          movementType: 'UNAVAILABLE_OUT',
        });
      }
    }
    if (plans.length === 0) {
      return {
        changed: false,
        commandReceiptId: null,
        documentId: null,
        movementIds: [],
        stockChanges: [],
      };
    }
    const envelope = serializedEnvelope(
      'SERIALIZED_STOCKTAKE_POST',
      {
        sourceKey: input.sourceKey,
        idempotencyKey: input.idempotencyKey,
      },
      {
        stocktakeId: input.stocktakeId,
        warehouseId: warehouse.id,
        productId: product.id,
        actions: plans.map((plan) => ({
          scanId: plan.scan.id,
          unitId: plan.unit.id,
          expectedVersion: plan.unit.version,
          nextStatus: plan.nextStatus,
        })),
      },
    );
    const result = await this.executeSerializedCommandInTransaction(
      transaction,
      'SERIALIZED_STOCKTAKE_POST',
      actor,
      envelope,
      metadata,
      async (receipt) => {
        const now = new Date();
        const document = await this.createDocument(
          transaction,
          receipt,
          envelope,
          actor,
          {
            type: plans.some((plan) => plan.onHandDelta < 0)
              ? 'STOCK_LOSS'
              : 'UNAVAILABLE_ADJUSTMENT',
            warehouseId: warehouse.id,
            sourceType: 'STOCKTAKE',
            sourceId: input.stocktakeId,
            businessAt: now,
            reason: input.reason,
          },
        );
        const line = await repository.createDocumentLine(transaction, {
          documentId: document.id,
          lineNo: 1,
          productId: product.id,
          batchId: null,
          quantity: plans.length,
          condition: plans.some((plan) => plan.unavailableDelta > 0)
            ? 'UNAVAILABLE'
            : 'SALEABLE',
          productNameSnapshot: product.name,
          unitSnapshot: product.unit,
          purchaseUnitCostCents: null,
          notes: input.reason,
        });
        const movements = [];
        let onHandDelta = 0;
        let unavailableDelta = 0;
        for (const [index, plan] of plans.entries()) {
          const changed =
            await transaction.serializedInventoryUnit.updateMany({
              where: {
                id: plan.unit.id,
                productId: product.id,
                warehouseId: warehouse.id,
                status: plan.unit.status,
                version: plan.unit.version,
              },
              data: {
                status: plan.nextStatus,
                version: { increment: 1 },
                correctionReason: input.reason,
                correctedById: actorId(actor),
                correctedAt: now,
                updatedById: actorId(actor),
                updatedAt: now,
              },
            });
          if (Number(changed?.count || 0) !== 1) {
            throw concurrentUpdateError();
          }
          const movement = await repository.createMovement(transaction, {
            sourceKey: childSourceKey(
              envelope.sourceKey,
              `scan-${index + 1}-${plan.scan.id}`,
            ),
            documentLineId: line.id,
            warehouseId: warehouse.id,
            productId: product.id,
            batchId: plan.unit.inventoryBatchId,
            serializedUnitId: plan.unit.id,
            reservationId: null,
            movementType: plan.movementType,
            onHandDelta: plan.onHandDelta,
            reservedDelta: 0,
            unavailableDelta: plan.unavailableDelta,
            inTransitDelta: 0,
            businessAt: now,
            operatorUserId: actorId(actor),
            operatorNameSnapshot: actorName(actor),
            operatorRoleSnapshot: actorRole(actor),
            productNameSnapshot: product.name,
            unitSnapshot: product.unit,
            purchaseUnitCostCents: plan.unit.purchaseCostCents,
            reason: input.reason,
          });
          await transaction.stocktakeSerializedScan.update({
            where: { id: plan.scan.id },
            data: { actionMovementId: movement.id },
          });
          movements.push(movement);
          onHandDelta += plan.onHandDelta;
          unavailableDelta += plan.unavailableDelta;
        }
        const stockChange = await this.applyStockDelta(
          transaction,
          warehouse.id,
          product.id,
          {
            ...ZERO_DELTA,
            onHandDelta,
            unavailableDelta,
          },
          movements[movements.length - 1].id,
        );
        return {
          document,
          movementIds: movements.map((movement) => movement.id),
          stockChanges: [stockChange],
          unitIds: plans.map((plan) => plan.unit.id),
          auditBefore: {
            stocktakeId: input.stocktakeId,
            affectedUnitCount: plans.length,
          },
          auditAfter: {
            stocktakeId: input.stocktakeId,
            onHandDelta,
            unavailableDelta,
            affectedUnitCount: plans.length,
          },
        };
      },
    );
    return { ...result, changed: !result.replayed };
  }

  async reverseStocktakeInTransaction(
    transaction: any,
    actor: any,
    input: {
      stocktakeId: string;
      warehouseId: string;
      productId: string;
      documentId: string;
      sourceKey: string;
      idempotencyKey: string;
      reason: string;
    },
    metadata: any = {},
  ) {
    const repository = this.requiredRepository();
    const [product, scans, original] = await Promise.all([
      this.loadSerializedProduct(transaction, input.productId, false),
      transaction.stocktakeSerializedScan.findMany({
        where: {
          stocktakeId: input.stocktakeId,
          actionMovementId: { not: null },
        },
        include: {
          serializedUnit: true,
          actionMovement: true,
        },
        orderBy: [{ lineNo: 'desc' }, { id: 'desc' }],
      }),
      repository.findDocumentForReversal(transaction, input.documentId),
    ]);
    if (!original || original.reversedByDocument) {
      throw createHttpError(
        409,
        'INVENTORY_STOCKTAKE_ALREADY_REVERSED',
        'The serialized stocktake document is missing or already reversed.',
      );
    }
    if (scans.length === 0) {
      return {
        changed: false,
        commandReceiptId: null,
        documentId: null,
        movementIds: [],
        stockChanges: [],
      };
    }
    for (const scan of scans) {
      const movement = scan.actionMovement;
      const unit = scan.serializedUnit;
      const expectedCurrentStatus =
        Number(movement?.onHandDelta || 0) < 0
          ? 'VOID'
          : Number(movement?.unavailableDelta || 0) > 0
            ? 'UNAVAILABLE'
            : 'AVAILABLE';
      if (
        !movement ||
        !unit ||
        unit.warehouseId !== input.warehouseId ||
        unit.status !== expectedCurrentStatus ||
        Number(unit.version) !== Number(scan.expectedUnitVersion) + 1
      ) {
        throw createHttpError(
          409,
          'INVENTORY_STOCKTAKE_REVERSAL_CONFLICT',
          'A bottle changed after stocktake posting and cannot be reversed safely.',
        );
      }
    }
    const envelope = serializedEnvelope(
      'SERIALIZED_STOCKTAKE_REVERSE',
      {
        sourceKey: input.sourceKey,
        idempotencyKey: input.idempotencyKey,
      },
      {
        stocktakeId: input.stocktakeId,
        documentId: input.documentId,
        movementIds: scans.map((scan) => scan.actionMovementId),
      },
    );
    const result = await this.executeSerializedCommandInTransaction(
      transaction,
      'SERIALIZED_STOCKTAKE_REVERSE',
      actor,
      envelope,
      metadata,
      async (receipt) => {
        const now = new Date();
        const document = await this.createDocument(
          transaction,
          receipt,
          envelope,
          actor,
          {
            type: 'REVERSAL',
            warehouseId: input.warehouseId,
            sourceType: 'STOCKTAKE_REVERSE',
            sourceId: input.stocktakeId,
            businessAt: now,
            reason: input.reason,
          },
        );
        await transaction.inventoryDocument.update({
          where: { id: document.id },
          data: { reversalOfDocumentId: original.id },
        });
        const line = await repository.createDocumentLine(transaction, {
          documentId: document.id,
          lineNo: 1,
          productId: product.id,
          batchId: null,
          quantity: scans.length,
          condition: 'SALEABLE',
          productNameSnapshot: product.name,
          unitSnapshot: product.unit,
          purchaseUnitCostCents: null,
          notes: input.reason,
        });
        const movements = [];
        let onHandDelta = 0;
        let unavailableDelta = 0;
        for (const [index, scan] of scans.entries()) {
          const originalMovement = scan.actionMovement;
          const changed =
            await transaction.serializedInventoryUnit.updateMany({
              where: {
                id: scan.serializedUnit.id,
                warehouseId: input.warehouseId,
                status: scan.serializedUnit.status,
                version: scan.serializedUnit.version,
              },
              data: {
                status: scan.expectedUnitStatus,
                version: { increment: 1 },
                correctionReason: input.reason,
                correctedById: actorId(actor),
                correctedAt: now,
                updatedById: actorId(actor),
                updatedAt: now,
              },
            });
          if (Number(changed?.count || 0) !== 1) {
            throw concurrentUpdateError();
          }
          const movement = await repository.createMovement(transaction, {
            sourceKey: childSourceKey(
              envelope.sourceKey,
              `movement-${index + 1}-${scan.id}`,
            ),
            documentLineId: line.id,
            warehouseId: input.warehouseId,
            productId: product.id,
            batchId: scan.serializedUnit.inventoryBatchId,
            serializedUnitId: scan.serializedUnit.id,
            reservationId: null,
            movementType: 'REVERSAL',
            onHandDelta: -Number(originalMovement.onHandDelta || 0),
            reservedDelta: 0,
            unavailableDelta:
              -Number(originalMovement.unavailableDelta || 0),
            inTransitDelta: 0,
            businessAt: now,
            operatorUserId: actorId(actor),
            operatorNameSnapshot: actorName(actor),
            operatorRoleSnapshot: actorRole(actor),
            productNameSnapshot: product.name,
            unitSnapshot: product.unit,
            purchaseUnitCostCents:
              scan.serializedUnit.purchaseCostCents,
            reason: input.reason,
            reversalOfMovementId: originalMovement.id,
          });
          movements.push(movement);
          onHandDelta += movement.onHandDelta;
          unavailableDelta += movement.unavailableDelta;
        }
        const stockChange = await this.applyStockDelta(
          transaction,
          input.warehouseId,
          product.id,
          {
            ...ZERO_DELTA,
            onHandDelta,
            unavailableDelta,
          },
          movements[movements.length - 1].id,
        );
        await repository.markDocumentReversed(
          transaction,
          original.id,
          actor,
          now,
        );
        return {
          document,
          movementIds: movements.map((movement) => movement.id),
          stockChanges: [stockChange],
          unitIds: scans.map((scan) => scan.serializedUnit.id),
          auditBefore: {
            stocktakeId: input.stocktakeId,
            status: 'posted',
          },
          auditAfter: {
            stocktakeId: input.stocktakeId,
            status: 'reversed',
          },
        };
      },
    );
    return { ...result, changed: !result.replayed };
  }

  private async applyAssignmentCommand(
    transaction: any,
    actor: any,
    reservation: any,
    activeAssignments: any[],
    selectedNewUnits: any[],
    outbound: boolean,
    receipt: any,
    envelope: any,
    reason: string,
  ) {
    const repository = this.requiredRepository();
    const product = await this.loadSerializedProduct(
      transaction,
      reservation.productId,
    );
    await this.loadActiveWarehouse(
      transaction,
      reservation.warehouseId,
    );
    const outboundAssignments = outbound ? activeAssignments : [];
    const changeCount =
      selectedNewUnits.length + outboundAssignments.length;
    const document = await this.createDocument(
      transaction,
      receipt,
      envelope,
      actor,
      {
        type: outbound
          ? 'SALES_OUTBOUND'
          : 'RESERVATION_ADJUSTMENT',
        warehouseId: reservation.warehouseId,
        sourceType: 'SALES_ORDER',
        sourceId: reservation.salesOrderId,
        businessAt: new Date(),
        reason,
      },
    );
    const line = await repository.createDocumentLine(transaction, {
      documentId: document.id,
      lineNo: 1,
      productId: product.id,
      batchId: null,
      quantity: Math.max(1, changeCount),
      condition: 'SALEABLE',
      productNameSnapshot: product.name,
      unitSnapshot: product.unit,
      purchaseUnitCostCents: null,
      notes: reason,
    });
    const now = new Date();
    const movements = [];
    const newAssignments = [];
    for (const [index, unit] of selectedNewUnits.entries()) {
      assertAssignableUnit(unit, reservation);
      const nextStatus = outbound ? 'OUTBOUND' : 'RESERVED';
      const changed =
        await transaction.serializedInventoryUnit.updateMany({
          where: {
            id: unit.id,
            version: unit.version,
            warehouseId: reservation.warehouseId,
            productId: reservation.productId,
            status: 'AVAILABLE',
          },
          data: {
            status: nextStatus,
            version: { increment: 1 },
            salesOrderId: reservation.salesOrderId,
            salesOrderItemId: reservation.salesOrderItemId,
            orderCostSnapshotCents: unit.purchaseCostCents,
            updatedById: actorId(actor),
            updatedAt: now,
          },
        });
      if (Number(changed?.count || 0) !== 1) {
        throw inventoryUnitUnavailableError();
      }
      const assignment =
        await transaction.serializedInventoryAssignment.create({
          data: {
            id: crypto.randomUUID(),
            reservationId: reservation.id,
            serializedUnitId: unit.id,
            status: nextStatus,
            sourceKey: childSourceKey(
              envelope.sourceKey,
              `assignment-${index + 1}-${unit.id}`,
            ),
            activeUnitKey: outbound ? null : unit.id,
            purchaseCostSnapshotCents: unit.purchaseCostCents,
            reservedById: actorId(actor),
            reservedByNameSnapshot: actorName(actor),
            reservedByRoleSnapshot: actorRole(actor),
            reservedAt: now,
            outboundById: outbound ? actorId(actor) : null,
            outboundByNameSnapshot: outbound
              ? actorName(actor)
              : null,
            outboundByRoleSnapshot: outbound
              ? actorRole(actor)
              : null,
            outboundAt: outbound ? now : null,
            version: 0,
          },
        });
      newAssignments.push(assignment);
      movements.push(
        await repository.createMovement(transaction, {
          sourceKey: childSourceKey(
            envelope.sourceKey,
            `movement-new-${index + 1}-${unit.id}`,
          ),
          documentLineId: line.id,
          warehouseId: reservation.warehouseId,
          productId: product.id,
          batchId: unit.inventoryBatchId,
          serializedUnitId: unit.id,
          reservationId: reservation.id,
          movementType: outbound ? 'SALES_OUT' : 'RESERVE',
          onHandDelta: outbound ? -1 : 0,
          reservedDelta: outbound ? -1 : 0,
          unavailableDelta: 0,
          inTransitDelta: 0,
          businessAt: now,
          operatorUserId: actorId(actor),
          operatorNameSnapshot: actorName(actor),
          operatorRoleSnapshot: actorRole(actor),
          productNameSnapshot: product.name,
          unitSnapshot: product.unit,
          purchaseUnitCostCents: unit.purchaseCostCents,
          reason,
        }),
      );
    }
    for (const [index, assignment] of outboundAssignments.entries()) {
      const unit = assignment.serializedUnit;
      const unitChanged =
        await transaction.serializedInventoryUnit.updateMany({
          where: {
            id: unit.id,
            version: unit.version,
            warehouseId: reservation.warehouseId,
            productId: reservation.productId,
            status: 'RESERVED',
          },
          data: {
            status: 'OUTBOUND',
            version: { increment: 1 },
            updatedById: actorId(actor),
            updatedAt: now,
          },
        });
      const assignmentChanged =
        await transaction.serializedInventoryAssignment.updateMany({
          where: {
            id: assignment.id,
            version: assignment.version,
            status: 'RESERVED',
            activeUnitKey: unit.id,
          },
          data: {
            status: 'OUTBOUND',
            activeUnitKey: null,
            outboundById: actorId(actor),
            outboundByNameSnapshot: actorName(actor),
            outboundByRoleSnapshot: actorRole(actor),
            outboundAt: now,
            version: { increment: 1 },
          },
        });
      if (
        Number(unitChanged?.count || 0) !== 1 ||
        Number(assignmentChanged?.count || 0) !== 1
      ) {
        throw concurrentUpdateError();
      }
      movements.push(
        await repository.createMovement(transaction, {
          sourceKey: childSourceKey(
            envelope.sourceKey,
            `movement-existing-${index + 1}-${unit.id}`,
          ),
          documentLineId: line.id,
          warehouseId: reservation.warehouseId,
          productId: product.id,
          batchId: unit.inventoryBatchId,
          serializedUnitId: unit.id,
          reservationId: reservation.id,
          movementType: 'SALES_OUT',
          onHandDelta: -1,
          reservedDelta: -1,
          unavailableDelta: 0,
          inTransitDelta: 0,
          businessAt: now,
          operatorUserId: actorId(actor),
          operatorNameSnapshot: actorName(actor),
          operatorRoleSnapshot: actorRole(actor),
          productNameSnapshot: product.name,
          unitSnapshot: product.unit,
          purchaseUnitCostCents:
            assignment.purchaseCostSnapshotCents,
          reason,
        }),
      );
    }
    const outboundIncrement = outbound ? movements.length : 0;
    const assignedIncrement = selectedNewUnits.length;
    if (
      outboundIncrement > Number(reservation.reservedQty || 0)
    ) {
      throw createHttpError(
        409,
        'INVENTORY_RESERVATION_INSUFFICIENT',
        'The reservation does not contain enough demand to outbound the selected serialized units.',
      );
    }
    const nextAssigned = outbound
      ? Math.max(
          0,
          Number(reservation.assignedQty || 0) -
            outboundAssignments.length,
        )
      : Number(reservation.assignedQty || 0) + assignedIncrement;
    const nextOutbound =
      Number(reservation.outboundQty || 0) + outboundIncrement;
    const nextReserved =
      Number(reservation.reservedQty || 0) - outboundIncrement;
    const reservationChanged =
      await transaction.inventoryReservation.updateMany({
        where: {
          id: reservation.id,
          version: reservation.version,
        },
        data: {
          assignedQty: nextAssigned,
          outboundQty: nextOutbound,
          reservedQty: nextReserved,
          status:
            nextOutbound >= Number(reservation.requestedQty || 0)
              ? 'CONSUMED'
              : nextOutbound > 0 || nextAssigned > 0
                ? 'PARTIAL'
                : 'RESERVED',
          consumedAt:
            nextOutbound >= Number(reservation.requestedQty || 0)
              ? now
              : null,
          version: { increment: 1 },
        },
      });
    if (Number(reservationChanged?.count || 0) !== 1) {
      throw concurrentUpdateError();
    }
    const stockChanges = [];
    if (outboundIncrement > 0) {
      stockChanges.push(
        await this.applyStockDelta(
          transaction,
          reservation.warehouseId,
          reservation.productId,
          {
            ...ZERO_DELTA,
            onHandDelta: -outboundIncrement,
            reservedDelta: -outboundIncrement,
          },
          movements[movements.length - 1].id,
        ),
      );
    }
    await this.refreshOrderItemCostSnapshot(
      transaction,
      reservation,
    );
    return {
      document,
      movementIds: movements.map((movement) => movement.id),
      stockChanges,
      unitIds: [
        ...newAssignments.map(
          (assignment) => assignment.serializedUnitId,
        ),
        ...outboundAssignments.map(
          (assignment: any) => assignment.serializedUnitId,
        ),
      ],
      assignedQty: nextAssigned,
      outboundQty: nextOutbound,
      auditBefore: {
        reservationId: reservation.id,
        assignedQty: Number(reservation.assignedQty || 0),
        outboundQty: Number(reservation.outboundQty || 0),
      },
      auditAfter: {
        reservationId: reservation.id,
        assignedQty: nextAssigned,
        outboundQty: nextOutbound,
        changedUnitCount: changeCount,
      },
    };
  }

  private async applyReleaseAssignmentCommand(
    transaction: any,
    actor: any,
    reservation: any,
    assignments: any[],
    receipt: any,
    envelope: any,
    reason: string,
  ) {
    const repository = this.requiredRepository();
    const product = await this.loadSerializedProduct(
      transaction,
      reservation.productId,
      false,
    );
    const document = await this.createDocument(
      transaction,
      receipt,
      envelope,
      actor,
      {
        type: 'RESERVATION_ADJUSTMENT',
        warehouseId: reservation.warehouseId,
        sourceType: 'SALES_ORDER',
        sourceId: reservation.salesOrderId,
        businessAt: new Date(),
        reason,
      },
    );
    const line = await repository.createDocumentLine(transaction, {
      documentId: document.id,
      lineNo: 1,
      productId: product.id,
      batchId: null,
      quantity: assignments.length,
      condition: 'SALEABLE',
      productNameSnapshot: product.name,
      unitSnapshot: product.unit,
      purchaseUnitCostCents: null,
      notes: reason,
    });
    const now = new Date();
    const movements = [];
    for (const [index, assignment] of assignments.entries()) {
      const unit = assignment.serializedUnit;
      const unitChanged =
        await transaction.serializedInventoryUnit.updateMany({
          where: {
            id: unit.id,
            version: unit.version,
            status: 'RESERVED',
            warehouseId: reservation.warehouseId,
          },
          data: {
            status: 'AVAILABLE',
            version: { increment: 1 },
            salesOrderId: null,
            salesOrderItemId: null,
            orderCostSnapshotCents: null,
            updatedById: actorId(actor),
            updatedAt: now,
          },
        });
      const assignmentChanged =
        await transaction.serializedInventoryAssignment.updateMany({
          where: {
            id: assignment.id,
            version: assignment.version,
            status: 'RESERVED',
            activeUnitKey: unit.id,
          },
          data: {
            status: 'RELEASED',
            activeUnitKey: null,
            releasedById: actorId(actor),
            releasedByNameSnapshot: actorName(actor),
            releasedByRoleSnapshot: actorRole(actor),
            releasedAt: now,
            releaseReason: reason,
            version: { increment: 1 },
          },
        });
      if (
        Number(unitChanged?.count || 0) !== 1 ||
        Number(assignmentChanged?.count || 0) !== 1
      ) {
        throw concurrentUpdateError();
      }
      movements.push(
        await repository.createMovement(transaction, {
          sourceKey: childSourceKey(
            envelope.sourceKey,
            `movement-${index + 1}-${unit.id}`,
          ),
          documentLineId: line.id,
          warehouseId: reservation.warehouseId,
          productId: product.id,
          batchId: unit.inventoryBatchId,
          serializedUnitId: unit.id,
          reservationId: reservation.id,
          movementType: 'RELEASE',
          ...ZERO_DELTA,
          businessAt: now,
          operatorUserId: actorId(actor),
          operatorNameSnapshot: actorName(actor),
          operatorRoleSnapshot: actorRole(actor),
          productNameSnapshot: product.name,
          unitSnapshot: product.unit,
          purchaseUnitCostCents:
            assignment.purchaseCostSnapshotCents,
          reason,
        }),
      );
    }
    const nextAssigned = Math.max(
      0,
      Number(reservation.assignedQty || 0) - assignments.length,
    );
    const changed =
      await transaction.inventoryReservation.updateMany({
        where: {
          id: reservation.id,
          version: reservation.version,
        },
        data: {
          assignedQty: nextAssigned,
          status:
            Number(reservation.outboundQty || 0) > 0
              ? 'PARTIAL'
              : Number(reservation.reservedQty || 0) > 0
                ? 'RESERVED'
                : 'RELEASED',
          version: { increment: 1 },
        },
      });
    if (Number(changed?.count || 0) !== 1) {
      throw concurrentUpdateError();
    }
    await this.refreshOrderItemCostSnapshot(
      transaction,
      reservation,
    );
    return {
      document,
      movementIds: movements.map((movement) => movement.id),
      stockChanges: [],
      unitIds: assignments.map(
        (assignment: any) => assignment.serializedUnitId,
      ),
      auditBefore: {
        reservationId: reservation.id,
        assignedQty: Number(reservation.assignedQty || 0),
      },
      auditAfter: {
        reservationId: reservation.id,
        assignedQty: nextAssigned,
        releasedUnitCount: assignments.length,
      },
    };
  }

  private async executeSerializedCommandInTransaction(
    transaction: any,
    commandType: string,
    actor: any,
    envelope: any,
    metadata: any,
    apply: (receipt: any) => Promise<any>,
  ) {
    const repository = this.requiredRepository();
    const existing = await repository.findCommandReceipt(
      envelope.idempotencyKey,
      transaction,
    );
    if (existing) {
      if (existing.requestHash !== envelope.requestHash) {
        throw createHttpError(
          409,
          'INVENTORY_IDEMPOTENCY_KEY_CONFLICT',
          'The idempotency key was already used with different normalized content.',
        );
      }
      if (existing.status !== 'SUCCEEDED') {
        throw createHttpError(
          409,
          'INVENTORY_COMMAND_IN_PROGRESS',
          'The inventory command is already being processed.',
        );
      }
      return {
        ...(existing.resultSnapshot || {}),
        commandReceiptId: existing.id,
        replayed: true,
      };
    }
    const receipt = await repository.createCommandReceipt(transaction, {
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
    const outcome = await apply(receipt);
    if (this.operationLogsService) {
      await this.operationLogsService.appendLog(
        {
          userId: actorId(actor),
          actorNameSnapshot: actorName(actor),
          actorRoleSnapshot: actorRole(actor),
          action: `inventory.${commandType.toLowerCase()}.posted`,
          module: 'inventory',
          operationType: 'UPDATE',
          entityType: 'serialized_inventory',
          entityId: outcome.unitIds?.[0] ?? outcome.document.id,
          beforeData: outcome.auditBefore ?? null,
          afterData: outcome.auditAfter ?? null,
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
    }
    let postCommitTaskId = null;
    if (outcome.stockChanges?.length > 0) {
      const task = await repository.createPostCommitTask(transaction, {
        sourceKey: childSourceKey(envelope.sourceKey, 'post-commit'),
        commandReceiptId: receipt.id,
        taskType: 'REFRESH_INVENTORY_DERIVED_STATE',
        payload: {
          commandReceiptId: receipt.id,
          documentId: outcome.document.id,
          warehouseProductPairs: outcome.stockChanges.map(
            (change: any) => ({
              warehouseId: change.warehouseId,
              productId: change.productId,
            }),
          ),
          inventoryOrderContext:
            metadata?.inventoryOrderContext ?? null,
        },
        status: 'PENDING',
      });
      postCommitTaskId = task.id;
    }
    const resultSnapshot = {
      commandReceiptId: receipt.id,
      documentId: outcome.document.id,
      movementIds: outcome.movementIds ?? [],
      stockChanges: outcome.stockChanges ?? [],
      unitIds: outcome.unitIds ?? [],
      assignedQty: outcome.assignedQty ?? null,
      outboundQty: outcome.outboundQty ?? null,
      postCommitTaskId,
    };
    await repository.completeCommandReceipt(
      transaction,
      receipt.id,
      outcome.document.id,
      resultSnapshot,
    );
    return { ...resultSnapshot, replayed: false };
  }

  private async runStandaloneSerializedCommand(
    envelope: {
      sourceKey: string;
      idempotencyKey: string;
      requestHash: string;
    },
    work: (transaction: any) => Promise<any>,
  ) {
    const repository = this.requiredRepository();
    try {
      return await repository.runInTransaction(work);
    } catch (error: any) {
      if (error?.code !== 'P2002' && error?.code !== 'P2034') {
        throw error;
      }
      const existing = await repository.findCommandReceipt(
        envelope.idempotencyKey,
      );
      if (!existing) {
        throw error;
      }
      if (existing.requestHash !== envelope.requestHash) {
        throw createHttpError(
          409,
          'INVENTORY_IDEMPOTENCY_KEY_CONFLICT',
          'The idempotency key was already used with different normalized content.',
        );
      }
      if (existing.status !== 'SUCCEEDED') {
        throw createHttpError(
          409,
          'INVENTORY_COMMAND_IN_PROGRESS',
          'The inventory command is already being processed.',
        );
      }
      return {
        ...(existing.resultSnapshot || {}),
        commandReceiptId: existing.id,
        replayed: true,
      };
    }
  }

  private async createDocument(
    transaction: any,
    receipt: any,
    envelope: any,
    actor: any,
    input: any,
  ) {
    return await this.requiredRepository().createDocument(transaction, {
      documentNo: `SER-${receipt.id.replace(/-/g, '').slice(0, 24)}`,
      type: input.type,
      status: 'POSTED',
      warehouseId: input.warehouseId,
      fromWarehouseId: input.fromWarehouseId ?? null,
      toWarehouseId: input.toWarehouseId ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
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

  private async applyStockDelta(
    transaction: any,
    warehouseId: string,
    productId: string,
    delta: any,
    lastMovementId: string,
  ) {
    const repository = this.requiredRepository();
    const stock = await repository.getOrCreateStock(
      transaction,
      warehouseId,
      productId,
    );
    const after = {
      onHandQty: Number(stock.onHandQty || 0) + delta.onHandDelta,
      reservedQty:
        Number(stock.reservedQty || 0) + delta.reservedDelta,
      unavailableQty:
        Number(stock.unavailableQty || 0) +
        delta.unavailableDelta,
      inTransitQty:
        Number(stock.inTransitQty || 0) + delta.inTransitDelta,
    };
    assertRestrictedBalancesNonNegative(after);
    const changed = await repository.updateStockWithVersion(
      transaction,
      stock,
      delta,
      lastMovementId,
    );
    if (Number(changed?.count || 0) !== 1) {
      throw concurrentUpdateError();
    }
    return {
      warehouseId,
      productId,
      before: calculateStockMetrics({
        onHandQty: Number(stock.onHandQty || 0),
        reservedQty: Number(stock.reservedQty || 0),
        unavailableQty: Number(stock.unavailableQty || 0),
        inTransitQty: Number(stock.inTransitQty || 0),
      }),
      after: calculateStockMetrics(after),
      version: Number(stock.version || 0) + 1,
    };
  }

  private async refreshOrderItemCostSnapshot(
    transaction: any,
    reservation: any,
  ) {
    if (!reservation.salesOrderItemId) {
      return;
    }
    const assignments =
      await transaction.serializedInventoryAssignment.findMany({
        where: {
          reservationId: reservation.id,
          status: { in: ['RESERVED', 'OUTBOUND'] },
        },
        select: { purchaseCostSnapshotCents: true },
      });
    const costs = assignments
      .map((assignment: any) =>
        assignment.purchaseCostSnapshotCents === null
          ? null
          : Number(assignment.purchaseCostSnapshotCents),
      )
      .filter((cost: number | null): cost is number => cost !== null);
    const item = await transaction.salesOrderItem.findUnique({
      where: { id: reservation.salesOrderItemId },
      select: { id: true, quantity: true, subtotalCents: true },
    });
    if (!item) {
      return;
    }
    const complete = costs.length === Number(item.quantity || 0);
    const subtotal =
      costs.length > 0
        ? costs.reduce((sum, cost) => sum + cost, 0)
        : null;
    const sameUnitCost =
      complete &&
      costs.length > 0 &&
      costs.every((cost) => cost === costs[0])
        ? costs[0]
        : null;
    await transaction.salesOrderItem.update({
      where: { id: item.id },
      data: {
        actualUnitCostCents: sameUnitCost,
        actualCostSubtotalCents: subtotal,
        grossProfitCents:
          complete && subtotal !== null
            ? Number(item.subtotalCents || 0) - subtotal
            : null,
      },
    });
  }

  private async loadSerializedProduct(
    transaction: any,
    productId: string,
    activeRequired = true,
  ) {
    const product = await this.requiredRepository().findProduct(
      transaction,
      productId,
    );
    if (!product || (activeRequired && !product.isActive)) {
      throw createHttpError(
        404,
        'INVENTORY_PRODUCT_NOT_FOUND',
        'The serialized inventory product does not exist.',
      );
    }
    if (product.inventoryTrackingMode !== 'SERIALIZED') {
      throw createHttpError(
        409,
        'PRODUCT_NOT_SERIALIZED',
        'The product is not enabled for serialized inventory tracking.',
      );
    }
    return product;
  }

  private async loadActiveWarehouse(
    transaction: any,
    warehouseId: string,
  ) {
    const warehouse = await this.requiredRepository().findWarehouse(
      transaction,
      warehouseId,
    );
    if (!warehouse?.isActive) {
      throw createHttpError(
        404,
        'INVENTORY_WAREHOUSE_NOT_FOUND',
        'The active inventory warehouse does not exist.',
      );
    }
    return warehouse;
  }

  private requiredRepository() {
    if (!this.repository) {
      throw new Error(
        'SerializedInventoryAccountingAdapter repository is not configured.',
      );
    }
    return this.repository;
  }

  private async dispatchReceipt(receiptId: string | null) {
    if (receiptId && this.postCommitService) {
      await this.postCommitService.dispatchForReceipt(receiptId);
    }
  }
}

function serializedEnvelope(
  commandType: string,
  raw: any,
  payload: Record<string, unknown>,
) {
  const fallbackSource = `${commandType.toLowerCase()}:${shortHash(
    canonicalJson(payload),
  )}`;
  const sourceKey = normalizedBusinessKey(
    raw?.sourceKey ?? fallbackSource,
    'sourceKey',
  );
  const idempotencyKey = normalizedBusinessKey(
    raw?.idempotencyKey ?? `idem:${sourceKey}`,
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
    raw?.requestHash !== undefined &&
    String(raw.requestHash).trim().toLowerCase() !== requestHash
  ) {
    throw createHttpError(
      400,
      'INVENTORY_REQUEST_HASH_MISMATCH',
      'requestHash does not match the normalized serialized inventory command.',
    );
  }
  return { sourceKey, idempotencyKey, requestHash };
}

function serializedUnitHashSnapshot(row: any) {
  return {
    logisticsCode: row.normalizedLogisticsCode,
    moutaiName: row.normalizedMoutaiName,
    factoryDate:
      row.factoryDate instanceof Date
        ? row.factoryDate.toISOString()
        : row.factoryDate,
    productionBatch: row.productionBatch,
    batchSerialNo: row.batchSerialNo,
    purchaseCostCents: row.purchaseCostCents ?? null,
  };
}

function normalizeUnitIds(value: unknown, field: string) {
  if (!Array.isArray(value)) {
    throw createHttpError(
      400,
      'INVENTORY_SERIALIZED_UNIT_IDS_INVALID',
      `${field} must be an array.`,
    );
  }
  const normalized = value.map((raw, index) =>
    requiredString(raw, `${field}[${index}]`),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw createHttpError(
      400,
      'INVENTORY_SERIALIZED_TRANSFER_UNITS_DUPLICATE',
      `${field} cannot contain duplicate serialized unit IDs.`,
    );
  }
  return normalized;
}

function assertAssignableUnit(unit: any, reservation: any) {
  if (
    !unit ||
    unit.status !== 'AVAILABLE' ||
    unit.warehouseId !== reservation.warehouseId ||
    unit.productId !== reservation.productId ||
    unit.purchaseCostCents === null ||
    unit.purchaseCostCents === undefined ||
    !unit.moutaiName ||
    !unit.factoryDate ||
    !unit.productionBatch ||
    !unit.batchSerialNo ||
    !unit.logisticsCode
  ) {
    throw inventoryUnitUnavailableError();
  }
}

function inventoryUnitUnavailableError() {
  return createHttpError(
    409,
    'INVENTORY_UNIT_UNAVAILABLE',
    'A selected bottle is not available in the fulfillment warehouse, is missing cost or identity data, or was assigned concurrently.',
  );
}

function childSourceKey(sourceKey: string, suffix: string) {
  return `${sourceKey.slice(0, 120)}:${shortHash(suffix)}`;
}

function shortHash(value: string) {
  return crypto
    .createHash('sha256')
    .update(String(value))
    .digest('hex')
    .slice(0, 24);
}

function requiredString(value: unknown, field: string) {
  const normalized =
    typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > 191) {
    throw validationError(`${field} is required.`);
  }
  return normalized;
}

function requireRole(actor: any, roles: Set<string>) {
  if (!roles.has(actor?.role)) {
    throw createHttpError(
      403,
      'FORBIDDEN',
      'The current role is not allowed to change serialized inventory.',
    );
  }
}

function boundedTraceId(value: unknown) {
  const normalized =
    typeof value === 'string' ? value.trim() : '';
  return normalized ? normalized.slice(0, 64) : null;
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim()
    ? value.normalize('NFKC').trim()
    : null;
}

function validationError(message: string) {
  return createHttpError(400, 'VALIDATION_FAILED', message);
}

function concurrentUpdateError() {
  return createHttpError(
    409,
    'INVENTORY_CONCURRENT_UPDATE',
    'Serialized inventory changed concurrently. Refresh and retry.',
  );
}
