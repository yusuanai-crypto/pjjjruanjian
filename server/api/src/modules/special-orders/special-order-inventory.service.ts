import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import {
  calculateInventoryRequestHash,
  canonicalJson,
} from '../inventory/inventory-command.policy';
import { InventoryAccountingService } from '../inventory/inventory-accounting.service';
import { SerializedInventoryAccountingAdapter } from '../inventory/serialized-inventory-accounting.adapter';

type InventoryPostingResult = {
  commandReceiptIds: string[];
  documentIds: string[];
};

const EMPTY_POSTING: InventoryPostingResult = {
  commandReceiptIds: [],
  documentIds: [],
};

@Injectable()
export class SpecialOrderInventoryService {
  constructor(
    private readonly accounting: InventoryAccountingService,
    private readonly serialized: SerializedInventoryAccountingAdapter,
  ) {}

  async postApprovalInTransaction(
    tx: any,
    actor: any,
    order: any,
    eventVersion: number,
    metadata: any = {},
  ): Promise<InventoryPostingResult> {
    const result = newPostingResult();
    const defaultWarehouse =
      normalizeEnum(order.orderType) === 'BUYBACK'
        ? await this.requireDefaultWarehouse(tx)
        : null;
    let sequence = 0;

    for (const item of order.items || []) {
      const product = item.product;
      const trackingMode = normalizeEnum(product?.inventoryTrackingMode);
      if (!['QUANTITY', 'SERIALIZED'].includes(trackingMode)) {
        continue;
      }
      const quantity = Number(item.quantity || 0);
      if (!Number.isSafeInteger(quantity) || quantity === 0) {
        throw inventoryConflict(
          'SPECIAL_ORDER_INVENTORY_QUANTITY_INVALID',
          'Every inventory-tracked special-order line must have a non-zero integer quantity.',
        );
      }
      const warehouseId =
        normalizeEnum(order.orderType) === 'BUYBACK'
          ? defaultWarehouse.id
          : requiredId(item.warehouseId, 'item.warehouseId');
      await this.requireActiveWarehouse(tx, warehouseId);

      if (quantity < 0) {
        const adjusted = await this.postNegativeAdjustment(
          tx,
          actor,
          order,
          item,
          product,
          warehouseId,
          Math.abs(quantity),
          eventVersion,
          ++sequence,
          metadata,
        );
        mergePosting(result, adjusted);
        continue;
      }

      if (normalizeEnum(order.orderType) === 'BUYBACK') {
        if (trackingMode === 'SERIALIZED') {
          const serials = item.specialSerializedUnits || [];
          if (serials.length !== quantity) {
            throw inventoryConflict(
              'BUYBACK_SERIALIZED_CODES_REQUIRED',
              'Serialized buyback items require one real logistics code per bottle.',
            );
          }
          const batch = await this.createSerializedBuybackBatch(
            tx,
            actor,
            order,
            item,
            product,
            warehouseId,
            quantity,
            eventVersion,
          );
          const sourceKey = sourceKeyFor(
            order.id,
            eventVersion,
            item.id,
            'serialized-buyback-in',
            sequence,
          );
          const posted = await this.serialized.createUnitsInTransaction(
            tx,
            actor,
            {
              sourceKey,
              idempotencyKey: `idem:${sourceKey}`,
              warehouseId,
              productId: product.id,
              condition: normalizeEnum(item.inventoryCondition),
              sourceType: 'SPECIAL_ORDER_BUYBACK',
              sourceId: order.id,
              reason: `Buyback approval for ${order.orderNo}.`,
              units: serials.map((serial: any, index: number) => ({
                inventoryBatchId: batch.id,
                salesOrderId: order.id,
                salesOrderItemId: item.id,
                moutaiName: product.name,
                normalizedMoutaiName: normalizeText(product.name),
                factoryDate: order.orderDate,
                productionBatch: `BUYBACK-${datePart(order.orderDate)}`,
                batchSerialNo: serial.logisticsCodeSnapshot,
                logisticsCode: serial.logisticsCodeSnapshot,
                normalizedLogisticsCode:
                  serial.normalizedLogisticsCode,
                purchaseCostCents: Number(item.unitPriceCents || 0),
                sortOrder: index,
              })),
            },
            metadata,
          );
          await tx.serializedInventoryUnit.updateMany({
            where: {
              id: { in: posted.unitIds || [] },
            },
            data: {
              salesOrderId: order.id,
              salesOrderItemId: item.id,
            },
          });
          collectPosted(result, posted);
        } else {
          const posted = await this.runQuantity(
            tx,
            actor,
            'INBOUND',
            order,
            item,
            eventVersion,
            ++sequence,
            {
              warehouseId,
              productId: product.id,
              quantity,
              kind: 'PURCHASE_RECEIPT',
              condition: normalizeEnum(item.inventoryCondition),
              batch: {
                sourceLineKey: `special-order:${shortHash(order.id)}:${shortHash(item.id)}:v${eventVersion}`,
                supplierName: order.customerName,
                purchaseOrderNo: order.orderNo,
                purchaseUnitCostCents: Number(item.unitPriceCents || 0),
                fifoAt: order.orderDate,
              },
              notes: item.adjustmentReason || item.notes || null,
            },
            metadata,
          );
          collectPosted(result, posted);
        }
        continue;
      }

      const reserved = await this.runQuantity(
        tx,
        actor,
        'RESERVE',
        order,
        item,
        eventVersion,
        ++sequence,
        {
          warehouseId,
          productId: product.id,
          salesOrderId: order.id,
          salesOrderItemId: item.id,
          inventoryLineKey: item.inventoryLineKey,
          quantity,
        },
        metadata,
      );
      collectPosted(result, reserved);
      const reservation = reserved.reservation;
      if (!reservation) {
        throw inventoryConflict(
          'SPECIAL_ORDER_RESERVATION_MISSING',
          'The approved sales line did not produce an inventory reservation.',
        );
      }
      if (trackingMode === 'SERIALIZED') {
        const assigned =
          await this.serialized.assignReservationUnitsInTransaction(
            tx,
            actor,
            {
              reservationId: reservation.id,
              autoAssignCount: quantity,
              outbound:
                normalizeEnum(item.deliveryType) === 'SELF_PICKUP',
              sourceKey: sourceKeyFor(
                order.id,
                eventVersion,
                item.id,
                normalizeEnum(item.deliveryType) === 'SELF_PICKUP'
                  ? 'serialized-pickup-out'
                  : 'serialized-shipping-reserve',
                ++sequence,
              ),
              reason: `Special-order approval for ${order.orderNo}.`,
            },
            metadata,
          );
        result.commandReceiptIds.push(
          ...(assigned.commandReceiptIds || []),
        );
      } else if (
        normalizeEnum(item.deliveryType) === 'SELF_PICKUP'
      ) {
        const outbound = await this.outboundQuantityFromBatches(
          tx,
          actor,
          order,
          item,
          product,
          reservation,
          quantity,
          eventVersion,
          sequence,
          metadata,
        );
        mergePosting(result, outbound);
        sequence += outbound.documentIds.length;
      }
    }
    return dedupePosting(result);
  }

  async postCompletionInTransaction(
    tx: any,
    actor: any,
    order: any,
    eventVersion: number,
    metadata: any = {},
  ): Promise<InventoryPostingResult> {
    if (normalizeEnum(order.orderType) === 'BUYBACK') {
      return { ...EMPTY_POSTING };
    }
    const result = newPostingResult();
    const reservations = await tx.inventoryReservation.findMany({
      where: {
        salesOrderId: order.id,
        reservedQty: { gt: 0 },
      },
      orderBy: [{ inventoryLineKey: 'asc' }, { id: 'asc' }],
    });
    const itemsByLine = new Map<string, any>(
      (order.items || []).map((item: any) => [
        item.inventoryLineKey,
        item,
      ]),
    );
    let sequence = 0;
    for (const reservation of reservations) {
      const item = itemsByLine.get(reservation.inventoryLineKey);
      if (
        !item ||
        normalizeEnum(item.deliveryType) !== 'SHIPPING'
      ) {
        continue;
      }
      const product = item.product;
      const quantity = Number(reservation.reservedQty || 0);
      if (normalizeEnum(product?.inventoryTrackingMode) === 'SERIALIZED') {
        const posted =
          await this.serialized.assignReservationUnitsInTransaction(
            tx,
            actor,
            {
              reservationId: reservation.id,
              outbound: true,
              sourceKey: sourceKeyFor(
                order.id,
                eventVersion,
                item.id,
                'serialized-shipping-out',
                ++sequence,
              ),
              reason: `Special-order packing completed for ${order.orderNo}.`,
            },
            metadata,
          );
        result.commandReceiptIds.push(
          ...(posted.commandReceiptIds || []),
        );
      } else {
        const posted = await this.outboundQuantityFromBatches(
          tx,
          actor,
          order,
          item,
          product,
          reservation,
          quantity,
          eventVersion,
          sequence,
          metadata,
        );
        mergePosting(result, posted);
        sequence += posted.documentIds.length;
      }
    }
    return dedupePosting(result);
  }

  async reverseInTransaction(
    tx: any,
    actor: any,
    order: any,
    eventVersion: number,
    reason: string,
    metadata: any = {},
  ): Promise<InventoryPostingResult> {
    const result = newPostingResult();
    const reservations = await tx.inventoryReservation.findMany({
      where: { salesOrderId: order.id },
      orderBy: [{ inventoryLineKey: 'asc' }, { id: 'asc' }],
    });
    let sequence = 0;

    for (const reservation of reservations) {
      const reservedQty = Number(reservation.reservedQty || 0);
      if (reservedQty <= 0) {
        continue;
      }
      const product = (order.items || []).find(
        (item: any) =>
          item.inventoryLineKey === reservation.inventoryLineKey,
      )?.product;
      if (normalizeEnum(product?.inventoryTrackingMode) === 'SERIALIZED') {
        const released =
          await this.serialized.releaseReservationAssignmentsInTransaction(
            tx,
            actor,
            {
              reservationId: reservation.id,
              keepQty: 0,
              sourceKey: sourceKeyFor(
                order.id,
                eventVersion,
                reservation.id,
                'serialized-release',
                ++sequence,
              ),
              reason,
            },
            metadata,
          );
        result.commandReceiptIds.push(
          ...(released.commandReceiptIds || []),
        );
      }
      const refreshed = await tx.inventoryReservation.findUnique({
        where: { id: reservation.id },
      });
      if (Number(refreshed?.reservedQty || 0) > 0) {
        const released = await this.runQuantity(
          tx,
          actor,
          'RELEASE',
          order,
          { id: reservation.salesOrderItemId || reservation.id },
          eventVersion,
          ++sequence,
          {
            reservationId: reservation.id,
            quantity: Number(refreshed.reservedQty),
          },
          metadata,
          reason,
        );
        collectPosted(result, released);
      }
    }

    const serializedReversal = await this.reverseSerializedUnits(
      tx,
      actor,
      order,
      eventVersion,
      reason,
      sequence,
    );
    mergePosting(result, serializedReversal);
    sequence += serializedReversal.documentIds.length;

    const documents = await tx.inventoryDocument.findMany({
      where: {
        sourceId: order.id,
        status: 'POSTED',
        type: {
          in: [
            'PURCHASE_RECEIPT',
            'OTHER_IN',
            'SALES_OUTBOUND',
            'OTHER_OUT',
          ],
        },
      },
      include: {
        lines: {
          include: {
            movements: true,
          },
        },
      },
      orderBy: [{ businessAt: 'desc' }, { id: 'desc' }],
    });
    for (const document of documents) {
      const movements = (document.lines || []).flatMap(
        (line: any) => line.movements || [],
      );
      if (movements.some((movement: any) => movement.serializedUnitId)) {
        continue;
      }
      const reversed = await this.runQuantity(
        tx,
        actor,
        'REVERSE',
        order,
        { id: document.id },
        eventVersion,
        ++sequence,
        {
          documentId: document.id,
        },
        metadata,
        reason,
      );
      collectPosted(result, reversed);
    }
    return dedupePosting(result);
  }

  async dispatchCommittedReceipts(receiptIds: string[]) {
    await this.accounting.dispatchCommittedReceipts(
      Array.from(new Set(receiptIds.filter(Boolean))),
    );
  }

  private async postNegativeAdjustment(
    tx: any,
    actor: any,
    order: any,
    item: any,
    product: any,
    warehouseId: string,
    quantity: number,
    eventVersion: number,
    sequence: number,
    metadata: any,
  ) {
    if (normalizeEnum(product.inventoryTrackingMode) === 'SERIALIZED') {
      throw inventoryConflict(
        'SERIALIZED_NEGATIVE_ADJUSTMENT_UNSUPPORTED',
        'A serialized negative adjustment requires a dedicated bottle-level correction and cannot be posted from a special order.',
      );
    }
    const isBuyback = normalizeEnum(order.orderType) === 'BUYBACK';
    if (isBuyback) {
      return this.outboundQuantityWithoutReservation(
        tx,
        actor,
        order,
        item,
        product,
        warehouseId,
        quantity,
        eventVersion,
        sequence,
        metadata,
        'OTHER_OUT',
      );
    }
    const posted = await this.runQuantity(
      tx,
      actor,
      'INBOUND',
      order,
      item,
      eventVersion,
      sequence,
      {
        warehouseId,
        productId: product.id,
        quantity,
        kind: 'OTHER_IN',
        condition: normalizeEnum(item.inventoryCondition),
        notes: item.adjustmentReason,
      },
      metadata,
      item.adjustmentReason,
    );
    return postingFrom(posted);
  }

  private async outboundQuantityFromBatches(
    tx: any,
    actor: any,
    order: any,
    item: any,
    product: any,
    reservation: any,
    quantity: number,
    eventVersion: number,
    sequence: number,
    metadata: any,
  ) {
    const result = newPostingResult();
    const allocations = await allocateBatches(
      tx,
      reservation.warehouseId,
      product.id,
      quantity,
    );
    for (const [index, allocation] of allocations.entries()) {
      const posted = await this.runQuantity(
        tx,
        actor,
        'OUTBOUND',
        order,
        item,
        eventVersion,
        sequence + index + 1,
        {
          warehouseId: reservation.warehouseId,
          productId: product.id,
          reservationId: reservation.id,
          quantity: allocation.quantity,
          kind: 'SALES_OUTBOUND',
          ...(allocation.batchId
            ? { batchId: allocation.batchId }
            : {}),
        },
        metadata,
      );
      collectPosted(result, posted);
    }
    return dedupePosting(result);
  }

  private async outboundQuantityWithoutReservation(
    tx: any,
    actor: any,
    order: any,
    item: any,
    product: any,
    warehouseId: string,
    quantity: number,
    eventVersion: number,
    sequence: number,
    metadata: any,
    kind: string,
  ) {
    const result = newPostingResult();
    const allocations = await allocateBatches(
      tx,
      warehouseId,
      product.id,
      quantity,
    );
    for (const [index, allocation] of allocations.entries()) {
      const posted = await this.runQuantity(
        tx,
        actor,
        'OUTBOUND',
        order,
        item,
        eventVersion,
        sequence + index,
        {
          warehouseId,
          productId: product.id,
          quantity: allocation.quantity,
          kind,
          ...(allocation.batchId
            ? { batchId: allocation.batchId }
            : {}),
        },
        metadata,
        item.adjustmentReason,
      );
      collectPosted(result, posted);
    }
    return dedupePosting(result);
  }

  private async runQuantity(
    tx: any,
    actor: any,
    commandType: any,
    order: any,
    item: any,
    eventVersion: number,
    sequence: number,
    payload: Record<string, unknown>,
    metadata: any,
    reason?: string | null,
  ) {
    const sourceKey = sourceKeyFor(
      order.id,
      eventVersion,
      item.id,
      String(commandType).toLowerCase(),
      sequence,
    );
    const input: any = {
      sourceKey,
      idempotencyKey: `idem:${sourceKey}`,
      sourceId: order.id,
      reason:
        reason ||
        `Special-order ${String(commandType).toLowerCase()} for ${order.orderNo}.`,
      ...payload,
    };
    input.requestHash = calculateInventoryRequestHash(
      commandType,
      input,
    );
    return this.accounting.executeAutomaticInTransaction(
      commandType,
      actor,
      input,
      tx,
      {
        ...metadata,
        inventoryOrderContext: {
          salesOrderId: order.id,
          inventoryLineKey: item.inventoryLineKey || null,
        },
      },
    );
  }

  private async createSerializedBuybackBatch(
    tx: any,
    actor: any,
    order: any,
    item: any,
    product: any,
    warehouseId: string,
    quantity: number,
    eventVersion: number,
  ) {
    const sourceLineKey = `special-order-serialized:${shortHash(order.id)}:${shortHash(item.id)}:v${eventVersion}`;
    const existing = await tx.inventoryBatch.findUnique({
      where: { sourceLineKey },
    });
    if (existing) {
      return existing;
    }
    const now = new Date();
    return tx.inventoryBatch.create({
      data: {
        id: crypto.randomUUID(),
        warehouseId,
        productId: product.id,
        sourceDocumentLineId: null,
        sourceLineKey,
        openingEntryKey: null,
        supplierName: order.customerName,
        purchaseOrderNo: order.orderNo,
        productionBatch: `BUYBACK-${datePart(order.orderDate)}`,
        productionDate: order.orderDate,
        receivedQty: quantity,
        remainingQty: quantity,
        unavailableQty:
          normalizeEnum(item.inventoryCondition) === 'UNAVAILABLE'
            ? quantity
            : 0,
        purchaseUnitCostCents: Number(item.unitPriceCents || 0),
        costStatus: 'COMPLETE',
        costCompletedById: actor.id,
        costCompletedByName: actor.name || null,
        costCompletedByRole: actor.role || null,
        costCompletedAt: now,
        fifoAt: order.orderDate,
        version: 0,
        createdById: actor.id,
        updatedById: actor.id,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  private async reverseSerializedUnits(
    tx: any,
    actor: any,
    order: any,
    eventVersion: number,
    reason: string,
    sequence: number,
  ): Promise<InventoryPostingResult> {
    const units = await tx.serializedInventoryUnit.findMany({
      where: { salesOrderId: order.id },
      include: {
        assignments: {
          where: {
            reservation: {
              is: { salesOrderId: order.id },
            },
          },
          include: { reservation: true },
        },
        inventoryMovements: {
          orderBy: [{ businessAt: 'desc' }, { id: 'desc' }],
          include: { reversedByMovement: true },
        },
      },
      orderBy: [{ productId: 'asc' }, { id: 'asc' }],
    });
    if (units.length === 0) {
      return { ...EMPTY_POSTING };
    }
    const isBuyback = normalizeEnum(order.orderType) === 'BUYBACK';
    const groups = new Map<string, any[]>();
    for (const unit of units) {
      const expected = isBuyback
        ? ['AVAILABLE', 'UNAVAILABLE', 'PENDING_COST']
        : ['OUTBOUND'];
      if (!expected.includes(normalizeEnum(unit.status))) {
        throw inventoryConflict(
          'SPECIAL_ORDER_SERIALIZED_REVERSAL_CONFLICT',
          `Bottle ${unit.logisticsCode || unit.id} changed after posting and cannot be reversed safely.`,
        );
      }
      const unreversedMovement = (unit.inventoryMovements || []).find(
        (movement: any) =>
          !movement.reversalOfMovementId &&
          !movement.reversedByMovement &&
          (isBuyback
            ? ['PURCHASE_IN', 'OTHER_IN'].includes(
                normalizeEnum(movement.movementType),
              )
            : normalizeEnum(movement.movementType) === 'SALES_OUT'),
      );
      if (!unreversedMovement) {
        throw inventoryConflict(
          'SPECIAL_ORDER_SERIALIZED_REVERSAL_UNSAFE',
          `Bottle ${unit.logisticsCode || unit.id} has no reversible posting movement.`,
        );
      }
      unit.__originalMovement = unreversedMovement;
      const key = `${unit.warehouseId}:${unit.productId}`;
      groups.set(key, [...(groups.get(key) || []), unit]);
    }

    const result = newPostingResult();
    let groupIndex = 0;
    for (const groupUnits of groups.values()) {
      groupIndex += 1;
      const first = groupUnits[0];
      const sourceKey = sourceKeyFor(
        order.id,
        eventVersion,
        first.productId,
        'serialized-reversal',
        sequence + groupIndex,
      );
      const requestHash = sha256(
        canonicalJson({
          sourceKey,
          orderId: order.id,
          unitIds: groupUnits.map((unit) => unit.id).sort(),
          reason,
        }),
      );
      const replay = await tx.inventoryCommandReceipt.findUnique({
        where: { idempotencyKey: `idem:${sourceKey}` },
      });
      if (replay) {
        if (replay.requestHash !== requestHash) {
          throw inventoryConflict(
            'INVENTORY_IDEMPOTENCY_KEY_CONFLICT',
            'The serialized reversal idempotency key was reused with different content.',
          );
        }
        result.commandReceiptIds.push(replay.id);
        if (replay.resultDocumentId) {
          result.documentIds.push(replay.resultDocumentId);
        }
        continue;
      }
      const receiptId = crypto.randomUUID();
      await tx.inventoryCommandReceipt.create({
        data: {
          id: receiptId,
          sourceKey: `${sourceKey}:receipt`,
          idempotencyKey: `idem:${sourceKey}`,
          commandType: 'SPECIAL_ORDER_SERIALIZED_REVERSE',
          requestHash,
          status: 'PROCESSING',
          actorUserId: actor.id,
          actorNameSnapshot: actor.name || null,
          actorRoleSnapshot: actor.role || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      const now = new Date();
      const document = await tx.inventoryDocument.create({
        data: {
          id: crypto.randomUUID(),
          documentNo: `SOR-${receiptId.replace(/-/g, '').slice(0, 20).toUpperCase()}`,
          type: 'REVERSAL',
          status: 'POSTED',
          warehouseId: first.warehouseId,
          sourceType: 'SPECIAL_ORDER_REVERSAL',
          sourceId: order.id,
          sourceKey,
          requestHash,
          businessAt: now,
          postedById: actor.id,
          postedByNameSnapshot: actor.name || null,
          postedByRoleSnapshot: actor.role || null,
          postedAt: now,
          reason,
          createdById: actor.id,
          updatedById: actor.id,
          createdAt: now,
          updatedAt: now,
        },
      });
      const product = await tx.product.findUnique({
        where: { id: first.productId },
      });
      const line = await tx.inventoryDocumentLine.create({
        data: {
          id: crypto.randomUUID(),
          documentId: document.id,
          lineNo: 1,
          productId: first.productId,
          batchId: first.inventoryBatchId || null,
          quantity: groupUnits.length,
          condition:
            normalizeEnum(first.status) === 'UNAVAILABLE'
              ? 'UNAVAILABLE'
              : 'SALEABLE',
          productNameSnapshot: product?.name || 'Unknown product',
          unitSnapshot: product?.unit || 'unit',
          purchaseUnitCostCents: first.purchaseCostCents,
          notes: reason,
          createdAt: now,
        },
      });
      const movementIds: string[] = [];
      let unavailableDelta = 0;
      const reservationAdjustments = new Map<
        string,
        { reservation: any; quantity: number }
      >();
      for (const [index, unit] of groupUnits.entries()) {
        const original = unit.__originalMovement;
        const nextStatus = isBuyback ? 'VOID' : 'AVAILABLE';
        const changed = await tx.serializedInventoryUnit.updateMany({
          where: {
            id: unit.id,
            version: unit.version,
            status: unit.status,
            salesOrderId: order.id,
          },
          data: {
            status: nextStatus,
            warehouseId: isBuyback ? null : unit.warehouseId,
            salesOrderId: null,
            salesOrderItemId: null,
            orderCostSnapshotCents: null,
            version: { increment: 1 },
            updatedById: actor.id,
            updatedAt: now,
          },
        });
        if (Number(changed?.count || 0) !== 1) {
          throw inventoryConflict(
            'SPECIAL_ORDER_SERIALIZED_REVERSAL_CONFLICT',
            'A serialized bottle changed concurrently while reversing the special order.',
          );
        }
        if (!isBuyback) {
          for (const assignment of unit.assignments || []) {
            if (normalizeEnum(assignment.status) !== 'OUTBOUND') {
              continue;
            }
            const assignmentChanged =
              await tx.serializedInventoryAssignment.updateMany({
              where: {
                id: assignment.id,
                version: assignment.version,
                status: 'OUTBOUND',
              },
              data: {
                status: 'RELEASED',
                releasedById: actor.id,
                releasedByNameSnapshot: actor.name || null,
                releasedByRoleSnapshot: actor.role || null,
                releasedAt: now,
                releaseReason: reason,
                version: { increment: 1 },
              },
            });
            if (Number(assignmentChanged?.count || 0) !== 1) {
              throw inventoryConflict(
                'SPECIAL_ORDER_SERIALIZED_REVERSAL_CONFLICT',
                'A serialized assignment changed concurrently while reversing the special order.',
              );
            }
            const reservation = assignment.reservation;
            const adjustment = reservationAdjustments.get(
              reservation.id,
            ) || {
              reservation,
              quantity: 0,
            };
            reservationAdjustments.set(reservation.id, {
              reservation,
              quantity: adjustment.quantity + 1,
            });
          }
        }
        const movement = await tx.inventoryMovement.create({
          data: {
            id: crypto.randomUUID(),
            sourceKey: `${sourceKey}:unit:${index + 1}`,
            documentLineId: line.id,
            warehouseId: unit.warehouseId,
            productId: unit.productId,
            batchId: unit.inventoryBatchId,
            serializedUnitId: unit.id,
            reservationId:
              unit.assignments?.[0]?.reservationId || null,
            movementType: 'REVERSAL',
            onHandDelta: isBuyback ? -1 : 1,
            reservedDelta: 0,
            unavailableDelta:
              isBuyback &&
              ['UNAVAILABLE', 'PENDING_COST'].includes(
                normalizeEnum(unit.status),
              )
                ? -1
                : 0,
            inTransitDelta: 0,
            businessAt: now,
            operatorUserId: actor.id,
            operatorNameSnapshot: actor.name || null,
            operatorRoleSnapshot: actor.role || null,
            productNameSnapshot: product?.name || 'Unknown product',
            unitSnapshot: product?.unit || 'unit',
            purchaseUnitCostCents: unit.purchaseCostCents,
            reason,
            reversalOfMovementId: original.id,
            createdAt: now,
          },
        });
        unavailableDelta += Number(movement.unavailableDelta || 0);
        movementIds.push(movement.id);
        if (isBuyback && unit.inventoryBatchId) {
          const batchChanged = await tx.inventoryBatch.updateMany({
            where: {
              id: unit.inventoryBatchId,
              remainingQty: { gte: 1 },
            },
            data: {
              remainingQty: { decrement: 1 },
              unavailableQty:
                ['UNAVAILABLE', 'PENDING_COST'].includes(
                  normalizeEnum(unit.status),
                )
                  ? { decrement: 1 }
                  : undefined,
              version: { increment: 1 },
              updatedById: actor.id,
              updatedAt: now,
            },
          });
          if (Number(batchChanged?.count || 0) !== 1) {
            throw inventoryConflict(
              'SPECIAL_ORDER_INBOUND_DEPENDENCY_EXISTS',
              'A buyback bottle or its purchase batch has already been consumed and cannot be reversed safely.',
            );
          }
        }
      }
      for (const { reservation, quantity } of reservationAdjustments.values()) {
        const reservationChanged = await tx.inventoryReservation.updateMany({
          where: {
            id: reservation.id,
            version: reservation.version,
            outboundQty: { gte: quantity },
          },
          data: {
            outboundQty: { decrement: quantity },
            status: 'RELEASED',
            version: { increment: 1 },
          },
        });
        if (Number(reservationChanged?.count || 0) !== 1) {
          throw inventoryConflict(
            'SPECIAL_ORDER_SERIALIZED_REVERSAL_CONFLICT',
            'A serialized reservation changed concurrently while reversing the special order.',
          );
        }
      }
      await updateStockWithVersion(
        tx,
        first.warehouseId,
        first.productId,
        {
          onHandDelta: isBuyback
            ? -groupUnits.length
            : groupUnits.length,
          reservedDelta: 0,
          unavailableDelta,
          inTransitDelta: 0,
        },
        movementIds[movementIds.length - 1],
      );
      await tx.inventoryCommandReceipt.update({
        where: { id: receiptId },
        data: {
          status: 'SUCCEEDED',
          resultDocumentId: document.id,
          resultSnapshot: {
            commandReceiptId: receiptId,
            documentId: document.id,
            movementIds,
            unitIds: groupUnits.map((unit) => unit.id),
          },
          completedAt: now,
          updatedAt: now,
        },
      });
      result.commandReceiptIds.push(receiptId);
      result.documentIds.push(document.id);
    }
    return dedupePosting(result);
  }

  private async requireDefaultWarehouse(tx: any) {
    const warehouses = await tx.warehouse.findMany({
      where: {
        isActive: true,
        isDefault: true,
        activeDefaultKey: 'ACTIVE_DEFAULT',
      },
      take: 2,
      orderBy: { id: 'asc' },
    });
    if (warehouses.length !== 1) {
      throw inventoryConflict(
        'INVENTORY_DEFAULT_WAREHOUSE_NOT_UNIQUE',
        'Exactly one active default warehouse is required for buyback approval.',
      );
    }
    return warehouses[0];
  }

  private async requireActiveWarehouse(tx: any, warehouseId: string) {
    const warehouse = await tx.warehouse.findUnique({
      where: { id: warehouseId },
    });
    if (!warehouse?.isActive) {
      throw inventoryConflict(
        'SPECIAL_ORDER_WAREHOUSE_INACTIVE',
        'A selected line warehouse is missing or inactive.',
      );
    }
    return warehouse;
  }
}

async function allocateBatches(
  tx: any,
  warehouseId: string,
  productId: string,
  quantity: number,
) {
  const batches = await tx.inventoryBatch.findMany({
    where: {
      warehouseId,
      productId,
      costStatus: 'COMPLETE',
      remainingQty: { gt: 0 },
    },
    orderBy: [{ fifoAt: 'asc' }, { id: 'asc' }],
  });
  const allocations: Array<{
    batchId: string | null;
    quantity: number;
  }> = [];
  let remaining = quantity;
  for (const batch of batches) {
    const available = Math.max(
      0,
      Number(batch.remainingQty || 0) -
        Number(batch.unavailableQty || 0),
    );
    if (available <= 0) {
      continue;
    }
    const allocated = Math.min(remaining, available);
    allocations.push({ batchId: batch.id, quantity: allocated });
    remaining -= allocated;
    if (remaining === 0) {
      break;
    }
  }
  if (remaining > 0) {
    allocations.push({ batchId: null, quantity: remaining });
  }
  return allocations;
}

async function updateStockWithVersion(
  tx: any,
  warehouseId: string,
  productId: string,
  delta: any,
  lastMovementId: string,
) {
  const stock = await tx.warehouseProductStock.findUnique({
    where: {
      warehouseId_productId: { warehouseId, productId },
    },
  });
  if (!stock) {
    throw inventoryConflict(
      'SPECIAL_ORDER_STOCK_MISSING',
      'The inventory stock snapshot required for reversal is missing.',
    );
  }
  const next = {
    onHandQty: Number(stock.onHandQty || 0) + delta.onHandDelta,
    reservedQty:
      Number(stock.reservedQty || 0) + delta.reservedDelta,
    unavailableQty:
      Number(stock.unavailableQty || 0) + delta.unavailableDelta,
    inTransitQty:
      Number(stock.inTransitQty || 0) + delta.inTransitDelta,
  };
  if (
    next.reservedQty < 0 ||
    next.unavailableQty < 0 ||
    next.inTransitQty < 0
  ) {
    throw inventoryConflict(
      'SPECIAL_ORDER_REVERSAL_BALANCE_INVALID',
      'The special order cannot be reversed because an inventory balance changed downstream.',
    );
  }
  const changed = await tx.warehouseProductStock.updateMany({
    where: { id: stock.id, version: stock.version },
    data: {
      ...next,
      lastMovementId,
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  });
  if (Number(changed?.count || 0) !== 1) {
    throw inventoryConflict(
      'INVENTORY_CONCURRENT_UPDATE',
      'Inventory changed concurrently while reversing the special order.',
    );
  }
}

function sourceKeyFor(
  orderId: string,
  eventVersion: number,
  lineId: string,
  action: string,
  sequence: number,
) {
  return `special:${shortHash(orderId)}:v${eventVersion}:${shortHash(lineId)}:${action}:${sequence}`;
}

function postingFrom(value: any): InventoryPostingResult {
  const result = newPostingResult();
  collectPosted(result, value);
  return dedupePosting(result);
}

function collectPosted(result: InventoryPostingResult, posted: any) {
  if (posted?.commandReceiptId) {
    result.commandReceiptIds.push(posted.commandReceiptId);
  }
  if (posted?.documentId) {
    result.documentIds.push(posted.documentId);
  }
}

function mergePosting(
  target: InventoryPostingResult,
  source: InventoryPostingResult,
) {
  target.commandReceiptIds.push(...(source.commandReceiptIds || []));
  target.documentIds.push(...(source.documentIds || []));
}

function newPostingResult(): InventoryPostingResult {
  return { commandReceiptIds: [], documentIds: [] };
}

function dedupePosting(
  result: InventoryPostingResult,
): InventoryPostingResult {
  return {
    commandReceiptIds: Array.from(
      new Set(result.commandReceiptIds.filter(Boolean)),
    ),
    documentIds: Array.from(
      new Set(result.documentIds.filter(Boolean)),
    ),
  };
}

function requiredId(value: unknown, field: string) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id) {
    throw inventoryConflict(
      'SPECIAL_ORDER_WAREHOUSE_REQUIRED',
      `${field} is required for inventory posting.`,
    );
  }
  return id;
}

function normalizeEnum(value: unknown) {
  return String(value || '').trim().toUpperCase();
}

function normalizeText(value: unknown) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-CN');
}

function shortHash(value: unknown) {
  return sha256(String(value || '')).slice(0, 20);
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function datePart(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  return Number.isNaN(date.getTime())
    ? 'UNKNOWN'
    : date.toISOString().slice(0, 10).replace(/-/g, '');
}

function inventoryConflict(code: string, message: string) {
  return createHttpError(409, code, message);
}
