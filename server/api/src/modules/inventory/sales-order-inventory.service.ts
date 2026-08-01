import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';
import {
  calculateInventoryRequestHash,
  InventoryCommandType,
} from './inventory-command.policy';
import { InventoryAccountingService } from './inventory-accounting.service';
import { SerializedInventoryAccountingAdapter } from './serialized-inventory-accounting.adapter';

const ACTIVE_ORDER_STATUSES = new Set(['VALID', 'PARTIAL_REFUND']);
const TERMINAL_ORDER_STATUSES = new Set(['CANCELLED', 'REFUNDED']);
const AUTOMATIC_COMMAND_TYPES = new Set<InventoryCommandType>([
  'RESERVE',
  'RELEASE',
  'OUTBOUND',
]);

export interface SalesOrderInventoryActivation {
  fulfillmentWarehouseId: string;
  inventoryAppliedAt: Date;
  inventoryPolicyVersion: number;
}

export interface SalesOrderInventorySyncResult {
  changed: boolean;
  commandReceiptIds: string[];
  shortageDetected: boolean;
}

@Injectable()
export class SalesOrderInventoryService {
  constructor(
    private readonly accountingService: InventoryAccountingService,
    private readonly serializedAdapter: SerializedInventoryAccountingAdapter,
  ) {}

  async prepareNewOrder(
    transaction: any,
    orderType: string,
    now = new Date(),
  ): Promise<SalesOrderInventoryActivation | null> {
    if (
      normalizeEnum(orderType) === 'AFTER_SALES' ||
      !hasInventoryDelegates(transaction)
    ) {
      return null;
    }
    const configuration =
      await transaction.inventoryConfiguration.findUnique({
        where: { singletonKey: 'INVENTORY' },
        select: {
          goLiveAt: true,
          policyVersion: true,
          maintenanceMode: true,
        },
      });
    if (
      !configuration?.goLiveAt ||
      new Date(configuration.goLiveAt).getTime() > now.getTime()
    ) {
      return null;
    }
    if (configuration.maintenanceMode) {
      throw createHttpError(
        409,
        'INVENTORY_MAINTENANCE_MODE',
        'Inventory-enabled sales orders are temporarily unavailable during inventory maintenance.',
      );
    }
    const defaultCandidates = await transaction.warehouse.findMany({
      where: {
        isActive: true,
        isDefault: true,
        activeDefaultKey: 'ACTIVE_DEFAULT',
      },
      select: { id: true, parentWarehouseId: true },
      orderBy: { id: 'asc' },
    });
    const defaults = defaultCandidates.filter(
      (warehouse: any) => !warehouse.parentWarehouseId,
    );
    if (defaults.length !== 1) {
      throw createHttpError(
        409,
        'INVENTORY_DEFAULT_WAREHOUSE_NOT_UNIQUE',
        'Exactly one active default warehouse is required for inventory-enabled sales orders.',
      );
    }
    return {
      fulfillmentWarehouseId: defaults[0].id,
      inventoryAppliedAt: now,
      inventoryPolicyVersion: Number(configuration.policyVersion || 1),
    };
  }

  async synchronize(
    transaction: any,
    actor: any,
    beforeOrder: any | null,
    afterOrder: any,
    metadata: any = {},
  ): Promise<SalesOrderInventorySyncResult> {
    if (
      !hasInventoryDelegates(transaction) ||
      !afterOrder?.inventoryAppliedAt
    ) {
      return emptySyncResult();
    }
    if (normalizeEnum(afterOrder.orderType) === 'AFTER_SALES') {
      if (
        beforeOrder?.inventoryAppliedAt &&
        normalizeEnum(beforeOrder.orderType) !== 'AFTER_SALES'
      ) {
        throw createHttpError(
          409,
          'INVENTORY_ORDER_TYPE_CHANGE_FORBIDDEN',
          'An inventory-enabled sales order cannot be converted to an after-sales financial order.',
        );
      }
      return emptySyncResult();
    }
    if (
      beforeOrder?.inventoryAppliedAt &&
      normalizeEnum(beforeOrder.orderType) === 'AFTER_SALES'
    ) {
      throw createHttpError(
        409,
        'INVENTORY_ORDER_TYPE_CHANGE_FORBIDDEN',
        'An after-sales financial order cannot be converted to an inventory-enabled sales order.',
      );
    }

    const warehouseId = requiredWarehouseId(
      afterOrder.fulfillmentWarehouseId,
    );
    await this.assertActiveWarehouse(transaction, warehouseId);
    const productModes = await loadProductModes(
      transaction,
      [
        ...(beforeOrder?.items || []),
        ...(afterOrder?.items || []),
      ],
    );
    const beforeLines = trackedLines(beforeOrder?.items || [], productModes);
    const afterLines = trackedLines(afterOrder?.items || [], productModes);
    assertStableQuantityLineKeys(afterLines);

    const reservations = await transaction.inventoryReservation.findMany({
      where: { salesOrderId: afterOrder.id },
      orderBy: [{ inventoryLineKey: 'asc' }, { id: 'asc' }],
    });
    const reservationsByLine = new Map(
      reservations.map((reservation: any) => [
        reservation.inventoryLineKey,
        reservation,
      ]),
    );
    const beforeByLine = new Map(
      beforeLines.map((line: any) => [line.inventoryLineKey, line]),
    );
    const afterByLine = new Map(
      afterLines.map((line: any) => [line.inventoryLineKey, line]),
    );

    this.assertOutboundLinesAreImmutable(
      reservations,
      beforeByLine,
      afterByLine,
      beforeOrder,
      afterOrder,
    );

    const actionsRequired = reservations.some((reservation: any) => {
      const line = afterByLine.get(reservation.inventoryLineKey);
      if (!line) {
        return Number(reservation.reservedQty || 0) > 0;
      }
      if (reservation.salesOrderItemId !== line.id) {
        return true;
      }
      return reservationNeedsAction(
        reservation,
        line,
        afterOrder,
        warehouseId,
        productModes.get(line.productId),
      );
    }) ||
      afterLines.some((line: any) => {
        const reservation = reservationsByLine.get(line.inventoryLineKey);
        return lineNeedsAction(
          reservation,
          line,
          afterOrder,
          warehouseId,
          productModes.get(line.productId),
        );
      }) ||
      afterLines.some(
        (line: any) =>
          productModes.get(line.productId) === 'SERIALIZED' &&
          selectedSerializedUnitIds(
            metadata?.serializedAssignments,
            line.inventoryLineKey,
          ).length > 0,
      );

    if (!actionsRequired) {
      return emptySyncResult();
    }

    const currentVersion = Number(beforeOrder?.inventoryVersion ?? 0);
    const claimed = await transaction.salesOrder.updateMany({
      where: {
        id: afterOrder.id,
        inventoryVersion: currentVersion,
      },
      data: {
        inventoryVersion: { increment: 1 },
      },
    });
    if (Number(claimed?.count || 0) !== 1) {
      throw createHttpError(
        409,
        'INVENTORY_ORDER_CONCURRENT_UPDATE',
        'The sales order inventory state changed concurrently. Refresh and retry.',
      );
    }
    const eventVersion = currentVersion + 1;
    const commandReceiptIds: string[] = [];
    let shortageDetected = false;
    let sequence = 0;

    const run = async (
      commandType: 'RESERVE' | 'RELEASE' | 'OUTBOUND',
      lineKey: string,
      action: string,
      payload: Record<string, unknown>,
    ) => {
      sequence += 1;
      const sourceKey = automaticSourceKey(
        afterOrder.id,
        eventVersion,
        lineKey,
        action,
        sequence,
      );
      const input: any = {
        sourceKey,
        idempotencyKey: `idem:${sourceKey}`,
        sourceId: afterOrder.id,
        reason: 'Automatic sales order inventory synchronization.',
        ...payload,
      };
      input.requestHash = calculateInventoryRequestHash(
        commandType,
        input,
      );
      const result =
        await this.accountingService.executeAutomaticInTransaction(
          commandType,
          actor,
          input,
          transaction,
          {
            ...metadata,
            inventoryOrderContext: {
              salesOrderId: afterOrder.id,
              inventoryLineKey: lineKey,
            },
          },
        );
      if (result.commandReceiptId) {
        commandReceiptIds.push(result.commandReceiptId);
      }
      shortageDetected =
        shortageDetected ||
        (result.stockChanges || []).some(
          (change: any) => Number(change?.after?.shortageQty || 0) > 0,
        );
      return result;
    };

    for (const reservation of reservations) {
      if (afterByLine.has(reservation.inventoryLineKey)) {
        continue;
      }
      if (
        productModes.get(reservation.productId) === 'SERIALIZED'
      ) {
        const released =
          await this.serializedAdapter.releaseReservationAssignmentsInTransaction(
            transaction,
            actor,
            {
              reservationId: reservation.id,
              keepQty: 0,
              sourceKey: automaticSourceKey(
                afterOrder.id,
                eventVersion,
                reservation.inventoryLineKey,
                'serialized-removed-release',
                ++sequence,
              ),
              reason:
                'Serialized order line was removed before outbound.',
            },
            metadata,
          );
        commandReceiptIds.push(...released.commandReceiptIds);
      }
      if (Number(reservation.reservedQty || 0) > 0) {
        await run(
          'RELEASE',
          reservation.inventoryLineKey,
          'removed-release',
          {
            reservationId: reservation.id,
            quantity: Number(reservation.reservedQty),
          },
        );
      }
    }

    for (const line of afterLines.sort(compareInventoryLineKeys)) {
      let reservation =
        await findReservation(
          transaction,
          afterOrder.id,
          line.inventoryLineKey,
        );
      if (
        reservation &&
        reservation.salesOrderItemId !== line.id
      ) {
        const rebound =
          await transaction.inventoryReservation.updateMany({
            where: {
              id: reservation.id,
              version: reservation.version,
            },
            data: {
              salesOrderItemId: line.id,
              version: { increment: 1 },
            },
          });
        if (Number(rebound?.count || 0) !== 1) {
          throw createHttpError(
            409,
            'INVENTORY_CONCURRENT_UPDATE',
            'The inventory reservation changed concurrently.',
          );
        }
        reservation = await findReservation(
          transaction,
          afterOrder.id,
          line.inventoryLineKey,
        );
      }
      const trackingMode = productModes.get(line.productId);
      const target = desiredLineState(
        afterOrder,
        line,
        reservation,
        trackingMode,
      );

      if (
        reservation &&
        reservation.warehouseId !== warehouseId &&
        Number(reservation.outboundQty || 0) === 0
      ) {
        if (productModes.get(line.productId) === 'SERIALIZED') {
          const released =
            await this.serializedAdapter.releaseReservationAssignmentsInTransaction(
              transaction,
              actor,
              {
                reservationId: reservation.id,
                keepQty: 0,
                sourceKey: automaticSourceKey(
                  afterOrder.id,
                  eventVersion,
                  line.inventoryLineKey,
                  'serialized-warehouse-release',
                  ++sequence,
                ),
                reason:
                  'Serialized assignments released before fulfillment warehouse change.',
              },
              metadata,
            );
          commandReceiptIds.push(...released.commandReceiptIds);
          reservation = await findReservation(
            transaction,
            afterOrder.id,
            line.inventoryLineKey,
          );
        }
        if (Number(reservation.reservedQty || 0) > 0) {
          await run(
            'RELEASE',
            line.inventoryLineKey,
            'warehouse-release',
            {
              reservationId: reservation.id,
              quantity: Number(reservation.reservedQty),
            },
          );
          reservation = await findReservation(
            transaction,
            afterOrder.id,
            line.inventoryLineKey,
          );
        }
        await rehomeReleasedReservation(
          transaction,
          reservation,
          warehouseId,
          line.productId,
        );
        reservation = await findReservation(
          transaction,
          afterOrder.id,
          line.inventoryLineKey,
        );
      }

      if (
        trackingMode === 'SERIALIZED' &&
        reservation &&
        target.outboundQty <= Number(reservation.outboundQty || 0) &&
        Number(reservation.assignedQty || 0) >
          target.reservedQty
      ) {
        const released =
          await this.serializedAdapter.releaseReservationAssignmentsInTransaction(
            transaction,
            actor,
            {
              reservationId: reservation.id,
              keepQty: target.reservedQty,
              sourceKey: automaticSourceKey(
                afterOrder.id,
                eventVersion,
                line.inventoryLineKey,
                'serialized-excess-release',
                ++sequence,
              ),
              reason:
                'Serialized assignment demand was reduced before outbound.',
            },
            metadata,
          );
        commandReceiptIds.push(...released.commandReceiptIds);
        reservation = await findReservation(
          transaction,
          afterOrder.id,
          line.inventoryLineKey,
        );
      }

      if (target.reservedQty > 0) {
        const currentReserved = Number(reservation?.reservedQty || 0);
        if (currentReserved < target.reservedQty) {
          const reserved = await run(
            'RESERVE',
            line.inventoryLineKey,
            'reserve',
            {
              warehouseId,
              productId: line.productId,
              salesOrderId: afterOrder.id,
              salesOrderItemId: line.id,
              inventoryLineKey: line.inventoryLineKey,
              quantity: target.reservedQty - currentReserved,
            },
          );
          reservation = reserved.reservation;
        } else if (currentReserved > target.reservedQty) {
          await run(
            'RELEASE',
            line.inventoryLineKey,
            'release',
            {
              reservationId: reservation.id,
              quantity: currentReserved - target.reservedQty,
            },
          );
          reservation = await findReservation(
            transaction,
            afterOrder.id,
            line.inventoryLineKey,
          );
        }
      } else if (
        !target.outboundQty &&
        Number(reservation?.reservedQty || 0) > 0
      ) {
        await run(
          'RELEASE',
          line.inventoryLineKey,
          'inactive-release',
          {
            reservationId: reservation.id,
            quantity: Number(reservation.reservedQty),
          },
        );
        reservation = await findReservation(
          transaction,
          afterOrder.id,
          line.inventoryLineKey,
        );
      }

      if (
        trackingMode === 'SERIALIZED' &&
        target.reservedQty > 0 &&
        reservation
      ) {
        const selectedUnitIds = selectedSerializedUnitIds(
          metadata?.serializedAssignments,
          line.inventoryLineKey,
        );
        if (selectedUnitIds.length > 0) {
          const assigned =
            await this.serializedAdapter.assignReservationUnitsInTransaction(
              transaction,
              actor,
              {
                reservationId: reservation.id,
                unitIds: selectedUnitIds,
                outbound: false,
                sourceKey: automaticSourceKey(
                  afterOrder.id,
                  eventVersion,
                  line.inventoryLineKey,
                  'serialized-assign',
                  ++sequence,
                ),
              },
              {
                ...metadata,
                inventoryOrderContext: {
                  salesOrderId: afterOrder.id,
                  inventoryLineKey: line.inventoryLineKey,
                },
              },
            );
          commandReceiptIds.push(...assigned.commandReceiptIds);
          reservation = await findReservation(
            transaction,
            afterOrder.id,
            line.inventoryLineKey,
          );
        }
      }

      if (target.outboundQty > Number(reservation?.outboundQty || 0)) {
        const outboundRemaining =
          target.outboundQty - Number(reservation?.outboundQty || 0);
        const reserveShortfall =
          outboundRemaining - Number(reservation?.reservedQty || 0);
        if (reserveShortfall > 0) {
          const reserved = await run(
            'RESERVE',
            line.inventoryLineKey,
            'outbound-reserve',
            {
              warehouseId,
              productId: line.productId,
              salesOrderId: afterOrder.id,
              salesOrderItemId: line.id,
              inventoryLineKey: line.inventoryLineKey,
              quantity: reserveShortfall,
            },
          );
          reservation = reserved.reservation;
        }
        if (trackingMode === 'SERIALIZED') {
          const deliveryType = normalizeEnum(line.deliveryType);
          const selectedUnitIds =
            deliveryType === 'SHIPPING'
              ? selectedSerializedUnitIds(
                  metadata?.serializedAssignments,
                  line.inventoryLineKey,
                )
              : [];
          const fulfilled =
            await this.serializedAdapter.assignReservationUnitsInTransaction(
              transaction,
              actor,
              {
                reservationId: reservation.id,
                unitIds: selectedUnitIds,
                autoAssignCount:
                  deliveryType === 'SELF_PICKUP'
                    ? outboundRemaining
                    : 0,
                outbound: true,
                sourceKey: automaticSourceKey(
                  afterOrder.id,
                  eventVersion,
                  line.inventoryLineKey,
                  'serialized-outbound',
                  ++sequence,
                ),
              },
              {
                ...metadata,
                inventoryOrderContext: {
                  salesOrderId: afterOrder.id,
                  inventoryLineKey: line.inventoryLineKey,
                },
              },
            );
          commandReceiptIds.push(...fulfilled.commandReceiptIds);
          reservation = await findReservation(
            transaction,
            afterOrder.id,
            line.inventoryLineKey,
          );
          shortageDetected =
            shortageDetected ||
            Number(reservation?.outboundQty || 0) <
              target.outboundQty;
          continue;
        }
        const allocations = await allocateSaleableBatches(
          transaction,
          warehouseId,
          line.productId,
          outboundRemaining,
        );
        for (const allocation of allocations) {
          await run(
            'OUTBOUND',
            line.inventoryLineKey,
            allocation.batchId
              ? `outbound-batch-${shortHash(allocation.batchId)}`
              : 'outbound-uncovered',
            {
              warehouseId,
              productId: line.productId,
              reservationId: reservation.id,
              quantity: allocation.quantity,
              kind: 'SALES_OUTBOUND',
              ...(allocation.batchId
                ? { batchId: allocation.batchId }
                : {}),
            },
          );
          reservation = await findReservation(
            transaction,
            afterOrder.id,
            line.inventoryLineKey,
          );
        }
      }
    }

    return {
      changed: true,
      commandReceiptIds: uniqueStrings(commandReceiptIds),
      shortageDetected,
    };
  }

  async dispatchCommittedReceipts(receiptIds: string[]) {
    await this.accountingService.dispatchCommittedReceipts(
      uniqueStrings(receiptIds),
    );
  }

  private async assertActiveWarehouse(
    transaction: any,
    warehouseId: string,
  ) {
    const warehouse = await transaction.warehouse.findUnique({
      where: { id: warehouseId },
      select: { id: true, isActive: true, parentWarehouseId: true },
    });
    if (!warehouse?.isActive) {
      throw createHttpError(
        409,
        'INVENTORY_FULFILLMENT_WAREHOUSE_INACTIVE',
        'The fulfillment warehouse is missing or inactive.',
      );
    }
    if (warehouse.parentWarehouseId) {
      throw createHttpError(
        409,
        'INVENTORY_FULFILLMENT_WAREHOUSE_MUST_BE_PARENT',
        '销售订单的履约仓只能选择启用的父仓，子仓不能直接履约。',
      );
    }
  }

  private assertOutboundLinesAreImmutable(
    reservations: any[],
    beforeByLine: Map<string, any>,
    afterByLine: Map<string, any>,
    beforeOrder: any,
    afterOrder: any,
  ) {
    const hasOutbound = reservations.some(
      (reservation) => Number(reservation.outboundQty || 0) > 0,
    );
    if (
      hasOutbound &&
      beforeOrder?.fulfillmentWarehouseId !==
        afterOrder.fulfillmentWarehouseId
    ) {
      throw outboundEditError(
        'The fulfillment warehouse cannot change after outbound.',
      );
    }
    for (const reservation of reservations) {
      if (Number(reservation.outboundQty || 0) <= 0) {
        continue;
      }
      const beforeLine = beforeByLine.get(reservation.inventoryLineKey);
      const afterLine = afterByLine.get(reservation.inventoryLineKey);
      if (
        !beforeLine ||
        !afterLine ||
        beforeLine.productId !== afterLine.productId ||
        Number(beforeLine.quantity) !== Number(afterLine.quantity) ||
        normalizeEnum(beforeLine.deliveryType) !==
          normalizeEnum(afterLine.deliveryType)
      ) {
        throw outboundEditError(
          'An outbound item cannot be removed or have its product, quantity, or delivery type changed.',
        );
      }
    }
  }
}

function hasInventoryDelegates(transaction: any) {
  return Boolean(
    transaction?.inventoryConfiguration &&
      transaction?.warehouse &&
      transaction?.inventoryReservation &&
      transaction?.inventoryCommandReceipt,
  );
}

function emptySyncResult(): SalesOrderInventorySyncResult {
  return {
    changed: false,
    commandReceiptIds: [],
    shortageDetected: false,
  };
}

function requiredWarehouseId(value: unknown) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id) {
    throw createHttpError(
      409,
      'INVENTORY_FULFILLMENT_WAREHOUSE_REQUIRED',
      'An inventory-enabled sales order requires a fulfillment warehouse.',
    );
  }
  return id;
}

async function loadProductModes(
  transaction: any,
  items: any[],
): Promise<Map<string, string>> {
  const ids = uniqueStrings(
    items.map((item) =>
      typeof item?.productId === 'string' ? item.productId : '',
    ),
  );
  if (ids.length === 0) {
    return new Map<string, string>();
  }
  const products = await transaction.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, inventoryTrackingMode: true },
  });
  return new Map<string, string>(
    products.map((product: any) => [
      product.id,
      normalizeEnum(product.inventoryTrackingMode),
    ]),
  );
}

function trackedLines(items: any[], productModes: Map<string, string>) {
  return items.filter(
    (item) =>
      productModes.get(item?.productId) === 'QUANTITY' ||
      productModes.get(item?.productId) === 'SERIALIZED',
  );
}

function assertStableQuantityLineKeys(lines: any[]) {
  const seen = new Set<string>();
  for (const line of lines) {
    const key =
      typeof line?.inventoryLineKey === 'string'
        ? line.inventoryLineKey.trim()
        : '';
    if (!key) {
      throw createHttpError(
        409,
        'INVENTORY_LINE_KEY_REQUIRED',
        'Every quantity-tracked order item requires a server-generated inventory line key.',
      );
    }
    if (seen.has(key)) {
      throw createHttpError(
        409,
        'INVENTORY_LINE_KEY_DUPLICATE',
        'Inventory line keys must be unique within a sales order.',
      );
    }
    seen.add(key);
  }
}

function desiredLineState(
  order: any,
  line: any,
  reservation: any,
  trackingMode?: string,
) {
  const currentOutbound = Number(
    reservation?.outboundQty || 0,
  );
  if (currentOutbound > 0 && trackingMode !== 'SERIALIZED') {
    return {
      reservedQty: 0,
      outboundQty: currentOutbound,
    };
  }
  const active = ACTIVE_ORDER_STATUSES.has(normalizeEnum(order.status));
  const deliveryType = normalizeEnum(line.deliveryType);
  const packed = normalizeEnum(order.packingStatus) === 'PACKED';
  const shouldOutbound =
    active &&
    (deliveryType === 'SELF_PICKUP' ||
      (deliveryType === 'SHIPPING' && packed));
  if (trackingMode === 'SERIALIZED') {
    return {
      reservedQty:
        active && deliveryType === 'SHIPPING' && !packed
          ? Math.max(0, Number(line.quantity) - currentOutbound)
          : 0,
      outboundQty: shouldOutbound
        ? Number(line.quantity)
        : currentOutbound,
    };
  }
  return {
    reservedQty:
      active && deliveryType === 'SHIPPING' && !packed
        ? Number(line.quantity)
        : 0,
    outboundQty: shouldOutbound
      ? Number(line.quantity)
      : Number(reservation?.outboundQty || 0),
  };
}

function reservationNeedsAction(
  reservation: any,
  line: any,
  order: any,
  warehouseId: string,
  trackingMode?: string,
) {
  const target = desiredLineState(
    order,
    line,
    reservation,
    trackingMode,
  );
  return (
    (reservation.warehouseId !== warehouseId &&
      Number(reservation.outboundQty || 0) === 0) ||
    Number(reservation.reservedQty || 0) !== target.reservedQty ||
    Number(reservation.outboundQty || 0) !== target.outboundQty
  );
}

function lineNeedsAction(
  reservation: any,
  line: any,
  order: any,
  warehouseId: string,
  trackingMode?: string,
) {
  const target = desiredLineState(
    order,
    line,
    reservation,
    trackingMode,
  );
  if (!reservation) {
    return target.reservedQty > 0 || target.outboundQty > 0;
  }
  return reservationNeedsAction(
    reservation,
    line,
    order,
    warehouseId,
    trackingMode,
  );
}

async function findReservation(
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

async function rehomeReleasedReservation(
  transaction: any,
  reservation: any,
  warehouseId: string,
  productId: string,
) {
  if (
    !reservation ||
    Number(reservation.reservedQty || 0) !== 0 ||
    Number(reservation.outboundQty || 0) !== 0
  ) {
    throw createHttpError(
      409,
      'INVENTORY_RESERVATION_SCOPE_CHANGE_FORBIDDEN',
      'A reservation can change warehouse only after its active quantity is fully released.',
    );
  }
  const updated = await transaction.inventoryReservation.updateMany({
    where: {
      id: reservation.id,
      version: reservation.version,
      reservedQty: 0,
      outboundQty: 0,
    },
    data: {
      warehouseId,
      productId,
      requestedQty: 0,
      assignedQty: 0,
      status: 'OPEN',
      releasedAt: null,
      version: { increment: 1 },
    },
  });
  if (Number(updated?.count || 0) !== 1) {
    throw createHttpError(
      409,
      'INVENTORY_CONCURRENT_UPDATE',
      'The inventory reservation changed concurrently.',
    );
  }
}

async function allocateSaleableBatches(
  transaction: any,
  warehouseId: string,
  productId: string,
  quantity: number,
) {
  if (!transaction?.inventoryBatch?.findMany) {
    return [{ batchId: null, quantity }];
  }
  const batches = await transaction.inventoryBatch.findMany({
    where: {
      warehouseId,
      productId,
      costStatus: 'COMPLETE',
      remainingQty: { gt: 0 },
    },
    select: {
      id: true,
      remainingQty: true,
      unavailableQty: true,
    },
    orderBy: [{ fifoAt: 'asc' }, { id: 'asc' }],
  });
  const result: Array<{ batchId: string | null; quantity: number }> = [];
  let remaining = quantity;
  for (const batch of batches) {
    const saleable = Math.max(
      0,
      Number(batch.remainingQty || 0) -
        Number(batch.unavailableQty || 0),
    );
    if (saleable <= 0) {
      continue;
    }
    const allocated = Math.min(remaining, saleable);
    result.push({ batchId: batch.id, quantity: allocated });
    remaining -= allocated;
    if (remaining === 0) {
      break;
    }
  }
  if (remaining > 0) {
    result.push({ batchId: null, quantity: remaining });
  }
  return result;
}

function automaticSourceKey(
  orderId: string,
  version: number,
  inventoryLineKey: string,
  action: string,
  sequence: number,
) {
  return [
    'sales-order',
    shortHash(orderId),
    `v${version}`,
    'line',
    shortHash(inventoryLineKey),
    action,
    String(sequence),
  ].join(':');
}

function shortHash(value: string) {
  return crypto
    .createHash('sha256')
    .update(String(value))
    .digest('hex')
    .slice(0, 20);
}

function uniqueStrings(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .map((value) =>
          typeof value === 'string' ? value.trim() : '',
        )
        .filter(Boolean),
    ),
  );
}

function selectedSerializedUnitIds(
  assignments: unknown,
  inventoryLineKey: string,
) {
  if (!Array.isArray(assignments)) {
    return [];
  }
  const match = assignments.find(
    (assignment: any) =>
      assignment?.inventoryLineKey === inventoryLineKey,
  );
  if (!match || !Array.isArray(match.unitIds)) {
    return [];
  }
  return uniqueStrings(match.unitIds);
}

function compareInventoryLineKeys(left: any, right: any) {
  return String(left.inventoryLineKey).localeCompare(
    String(right.inventoryLineKey),
    'en',
  );
}

function normalizeEnum(value: unknown) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function outboundEditError(message: string) {
  return createHttpError(
    409,
    'INVENTORY_OUTBOUND_ITEM_IMMUTABLE',
    `${message} Use after-sales or an inventory correction workflow.`,
  );
}

export function shouldAssignInventoryLineKeys(
  inventoryAppliedAt: unknown,
) {
  return Boolean(inventoryAppliedAt);
}

export function serverInventoryLineKey() {
  return `inventory-line:${crypto.randomUUID()}`;
}

export function assertAutomaticInventoryCommandType(
  commandType: InventoryCommandType,
) {
  if (!AUTOMATIC_COMMAND_TYPES.has(commandType)) {
    throw createHttpError(
      400,
      'INVENTORY_AUTOMATIC_COMMAND_FORBIDDEN',
      'Unsupported automatic inventory command.',
    );
  }
}

export function isTerminalSalesOrderStatus(value: unknown) {
  return TERMINAL_ORDER_STATUSES.has(normalizeEnum(value));
}
