import { PrismaClient } from '@prisma/client';

export type SerializedCutoverClassification =
  | 'CANDIDATE_RESERVED'
  | 'CANDIDATE_OUTBOUND'
  | 'MANUAL_CONFIRMATION'
  | 'CONFLICT';

export function classifyAllocatedUnit(unit: any): {
  classification: SerializedCutoverClassification;
  suggestedClassification: SerializedCutoverClassification | null;
  reasons: string[];
} {
  const order = unit?.salesOrder;
  const item = unit?.salesOrderItem;
  if (!order || !item) {
    return {
      classification: 'CONFLICT',
      suggestedClassification: null,
      reasons: [
        !order ? 'sales_order_missing' : 'sales_order_item_missing',
      ],
    };
  }
  const status = String(order.status || '').toUpperCase();
  if (status === 'CANCELLED' || status === 'REFUNDED') {
    return {
      classification: 'MANUAL_CONFIRMATION',
      suggestedClassification: null,
      reasons: [`terminal_order_status:${status.toLowerCase()}`],
    };
  }
  const orderDeliveryTypes = new Set(
    (order.items || [])
      .map((candidate: any) =>
        String(candidate.deliveryType || '').toUpperCase(),
      )
      .filter(Boolean),
  );
  if (orderDeliveryTypes.size !== 1) {
    return {
      classification: 'MANUAL_CONFIRMATION',
      suggestedClassification: null,
      reasons: ['mixed_or_missing_order_delivery_type'],
    };
  }
  const deliveryType = String(item.deliveryType || '').toUpperCase();
  if (deliveryType === 'SELF_PICKUP') {
    return {
      classification: 'MANUAL_CONFIRMATION',
      suggestedClassification: null,
      reasons: ['legacy_self_pickup_must_not_be_guessed'],
    };
  }
  if (deliveryType !== 'SHIPPING') {
    return {
      classification: 'CONFLICT',
      suggestedClassification: null,
      reasons: ['unsupported_item_delivery_type'],
    };
  }
  const suggestedClassification =
    String(order.packingStatus || '').toUpperCase() === 'PACKED'
      ? 'CANDIDATE_OUTBOUND'
      : 'CANDIDATE_RESERVED';
  const incompleteReasons = [
    !unit.warehouseId ? 'warehouse_missing' : null,
    unit.purchaseCostCents === null ||
    unit.purchaseCostCents === undefined
      ? 'purchase_cost_missing'
      : null,
    !unit.logisticsCode ? 'logistics_code_missing' : null,
    !unit.factoryDate ? 'factory_date_missing' : null,
    !unit.productionBatch ? 'production_batch_missing' : null,
    !unit.batchSerialNo ? 'batch_serial_no_missing' : null,
  ].filter((reason): reason is string => Boolean(reason));
  if (incompleteReasons.length > 0) {
    return {
      classification: 'MANUAL_CONFIRMATION',
      suggestedClassification,
      reasons: incompleteReasons,
    };
  }
  if (!['VALID', 'PARTIAL_REFUND'].includes(status)) {
    return {
      classification: 'MANUAL_CONFIRMATION',
      suggestedClassification,
      reasons: [`order_status_requires_review:${status.toLowerCase()}`],
    };
  }
  return {
    classification: suggestedClassification,
    suggestedClassification,
    reasons: [],
  };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const units = await prisma.serializedInventoryUnit.findMany({
      where: { status: 'ALLOCATED' },
      include: {
        salesOrder: {
          include: {
            items: {
              select: {
                id: true,
                deliveryType: true,
                inventoryLineKey: true,
              },
            },
          },
        },
        salesOrderItem: {
          select: {
            id: true,
            deliveryType: true,
            inventoryLineKey: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const rows = units.map((unit: any) => ({
      unitId: unit.id,
      salesOrderId: unit.salesOrderId,
      salesOrderItemId: unit.salesOrderItemId,
      inventoryLineKey: unit.salesOrderItem?.inventoryLineKey ?? null,
      ...classifyAllocatedUnit(unit),
    }));
    const counts = rows.reduce<Record<string, number>>((result, row) => {
      result[row.classification] =
        (result[row.classification] || 0) + 1;
      return result;
    }, {});
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: 'preview_only',
          writesPerformed: false,
          generatedAt: new Date().toISOString(),
          counts,
          rows,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        code: error?.code || 'SERIALIZED_CUTOVER_PREVIEW_FAILED',
        message: error?.message || String(error),
      })}\n`,
    );
    process.exitCode = 1;
  });
}
